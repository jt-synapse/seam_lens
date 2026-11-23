import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { BudgetExceededError, withBudgetedUsage } from '@/modules/vision/usage-ledger';

// A scratch PostgreSQL server with CREATEDB permission. Never use the application's DATABASE_URL.
const scratchUrl = process.env.SEAMLENS_TEST_POSTGRES_URL;
it.skipIf(!scratchUrl)('serializes two reservations on separate PostgreSQL connections', async () => {
  const database = 'seamlens_test_' + randomUUID().replaceAll('-', '');
  const admin = new Client({ connectionString: scratchUrl });
  const databaseUrl = new URL(scratchUrl!);
  databaseUrl.pathname = '/' + database;
  const session = () => new Client({ connectionString: databaseUrl.toString() });
  const gate = session();
  const contenders = [session(), session()];

  await admin.connect();
  try {
    await admin.query('CREATE DATABASE ' + database);
    try {
      await Promise.all([gate, ...contenders].map(client => client.connect()));
      // Exercise the actual predecessor ledger DDL and migration 003 on vanilla PostgreSQL.
      // PGlite's integration suite separately covers all catalog and pgvector migrations.
      const base = await readFile('supabase/migrations/202611220001_init_seamlens_v1.sql', 'utf8');
      const ledger = base.match(/^CREATE TABLE api_usage_ledger \([\s\S]*?^\);/m);
      if (!ledger) throw new Error('Missing original api_usage_ledger DDL');
      await gate.query(ledger[0]);
      await gate.query(await readFile('supabase/migrations/202611220003_ai_budget.sql', 'utf8'));

      const pids = await Promise.all(contenders.map(async client =>
        (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
      ));
      await gate.query('BEGIN');
      await gate.query("SELECT public.lock_api_usage_day((now() AT TIME ZONE 'UTC')::date)");
      vi.stubEnv('DAILY_AI_BUDGET_USD', '1');
      const paid = vi.fn(async () => ({
        value: true, inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.8,
      }));
      const outcomes = Promise.allSettled(contenders.map((client, i) =>
        withBudgetedUsage(client, { id: 'contender-' + i, operation: 'search_vision', maxCostUsd: 0.8 }, paid)
      ));

      try {
        const deadline = Date.now() + 5_000;
        let waiting = 0;
        while (waiting < 2 && Date.now() < deadline) {
          const result = await admin.query<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE pid = ANY($1::int[]) AND wait_event_type = 'Lock'",
            [pids]
          );
          waiting = result.rows[0].count;
          if (waiting < 2) await delay(20);
        }
        expect(waiting, 'both independent backends must overlap at the database lock').toBe(2);
      } finally {
        await gate.query('COMMIT');
        await outcomes;
      }
      expect(await outcomes).toEqual(expect.arrayContaining([
        { status: 'fulfilled', value: true },
        { status: 'rejected', reason: expect.any(BudgetExceededError) },
      ]));
      expect(paid).toHaveBeenCalledTimes(1);
      expect((await gate.query(
        'SELECT request_count, estimated_cost_usd::float8 FROM api_usage_ledger'
      )).rows).toEqual([{ request_count: 1, estimated_cost_usd: 0.8 }]);
    } finally {
      vi.unstubAllEnvs();
      await Promise.allSettled([gate, ...contenders].map(client => client.end()));
      await admin.query('DROP DATABASE ' + database);
    }
  } finally {
    await admin.end();
  }
}, 15_000);
