import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertDailyBudgetAvailable,
  BudgetExceededError,
  ConfirmedUnbilledError,
  DuplicateUsageRequestError,
  recordApiUsage,
  withBudgetedUsage,
} from '@/modules/vision/usage-ledger';

const migrations = [
  '202611220001_init_seamlens_v1.sql',
  '202611220002_catalog_integrity.sql',
  '202611220003_ai_budget.sql',
];

function usageRequest(id: string, maxCostUsd = 0.8) {
  return { id, operation: 'search_vision' as const, maxCostUsd };
}

const completedUsage = {
  value: 'provider result',
  inputTokens: 100,
  outputTokens: 20,
  estimatedCostUsd: 0.4,
};

describe('daily AI spend against migrated PostgreSQL', () => {
  let db: PGlite;

  beforeEach(async () => {
    vi.stubEnv('DAILY_AI_BUDGET_USD', '1');
    db = new PGlite({ extensions: { vector } });
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
    `);
    for (const migration of migrations) {
      await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
    }
  });

  afterEach(async () => {
    await db.close();
    vi.unstubAllEnvs();
  });

  it('admits one contender at the cap, settles once, and frees unused reservation spend', async () => {
    const entered = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<void>();
    const call = vi.fn(async () => {
      entered.resolve();
      await unblock.promise;
      return completedUsage;
    });

    const contenders = Promise.allSettled([
      withBudgetedUsage(db, usageRequest('first'), call),
      withBudgetedUsage(db, usageRequest('second'), call),
    ]);
    await entered.promise;
    try {
      await expect(assertDailyBudgetAvailable(db, 0.8)).rejects.toMatchObject({ statusCode: 503 });
      await expect(withBudgetedUsage(db, usageRequest('first', 0.1), call)).rejects.toBeInstanceOf(DuplicateUsageRequestError);
    } finally {
      unblock.resolve();
    }
    const results = await contenders;
    expect(results.filter(({ status }) => status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: 'provider result' },
    ]);
    expect(results.filter(({ status }) => status === 'rejected')).toEqual([
      { status: 'rejected', reason: expect.any(BudgetExceededError) },
    ]);
    expect(call).toHaveBeenCalledTimes(1);

    const recorded = await db.query(`
      SELECT request_count, input_tokens::int, output_tokens::int, estimated_cost_usd::float8
      FROM api_usage_ledger WHERE operation = 'search_vision'
    `);
    expect(recorded.rows).toEqual([
      { request_count: 1, input_tokens: 100, output_tokens: 20, estimated_cost_usd: 0.4 },
    ]);
    await expect(assertDailyBudgetAvailable(db, 0.8)).resolves.toBeUndefined();
    await expect(withBudgetedUsage(db, usageRequest('first', 0.1), call)).rejects.toBeInstanceOf(DuplicateUsageRequestError);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('accounts for settled and legacy spend using exact decimal cost', async () => {
    await db.exec(`
      INSERT INTO api_usage_ledger (operation, request_count, input_tokens, estimated_cost_usd)
      VALUES ('ingest_embed', 1, 15, 0.3)
    `);
    await recordApiUsage(db, {
      operation: 'ingest_embed',
      inputTokens: 1,
      outputTokens: 0,
      estimatedCostUsd: 0.00000002,
    });
    const call = vi.fn(async () => ({ ...completedUsage, estimatedCostUsd: 0.69 }));
    await expect(withBudgetedUsage(db, usageRequest('would-overspend', 0.7), call)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(withBudgetedUsage(db, usageRequest('fits', 0.69999998), call)).resolves.toBe('provider result');
    expect(call).toHaveBeenCalledTimes(1);

    const recorded = await db.query(`
      SELECT request_count, input_tokens::int, estimated_cost_usd::float8
      FROM api_usage_ledger WHERE operation = 'ingest_embed'
    `);
    expect(recorded.rows).toEqual([
      { request_count: 2, input_tokens: 16, estimated_cost_usd: 0.30000002 },
    ]);
  });

  it('retains uncertain charges and releases confirmed unbilled reservations', async () => {
    const unknown = new Error('connection dropped after dispatch');
    const unbilled = new ConfirmedUnbilledError('rejected before dispatch');
    const call = vi.fn(async () => completedUsage);
    await expect(withBudgetedUsage(db, usageRequest('unknown', 0.6), async () => { throw unknown; })).rejects.toBe(unknown);
    await expect(withBudgetedUsage(db, usageRequest('unbilled', 0.4), async () => { throw unbilled; })).rejects.toBe(unbilled);
    await expect(withBudgetedUsage(db, usageRequest('unknown', 0.1), call)).rejects.toBeInstanceOf(DuplicateUsageRequestError);
    await expect(withBudgetedUsage(db, usageRequest('too-large', 0.5), call)).rejects.toBeInstanceOf(BudgetExceededError);
    await expect(withBudgetedUsage(db, usageRequest('remaining', 0.4), call)).resolves.toBe('provider result');
    expect(call).toHaveBeenCalledTimes(1);
    await expect(assertDailyBudgetAvailable(db)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('settles against the reserved UTC day when the call spans midnight', async () => {
    await db.exec("SET TIME ZONE 'Pacific/Kiritimati'");
    await expect(withBudgetedUsage(db, usageRequest('overnight'), async () => {
      const reservation = await db.query(`
        SELECT usage_date = (statement_timestamp() AT TIME ZONE 'UTC')::date AS utc_matches
        FROM api_usage_reservations WHERE request_id = 'overnight'
      `);
      expect(reservation.rows).toEqual([{ utc_matches: true }]);

      // Simulate UTC midnight during the provider call by aging the persisted reservation one day.
      await db.exec(`
        UPDATE api_usage_reservations SET usage_date = usage_date - 1 WHERE request_id = 'overnight'
      `);
      await expect(assertDailyBudgetAvailable(db, 0.1)).resolves.toBeUndefined();
      return completedUsage;
    })).resolves.toBe('provider result');
    const ledger = await db.query(`
      SELECT usage_date = (statement_timestamp() AT TIME ZONE 'UTC')::date - 1 AS previous_utc_day
      FROM api_usage_ledger WHERE operation = 'search_vision'
    `);
    expect(ledger.rows).toEqual([{ previous_utc_day: true }]);
    await expect(assertDailyBudgetAvailable(db, 0.1)).resolves.toBeUndefined();
  });

  it('keeps a billed amount above its reservation in the ledger and opens the breaker', async () => {
    await expect(withBudgetedUsage(db, usageRequest('underestimated', 0.5), async () => ({
      ...completedUsage,
      estimatedCostUsd: 1.1,
    }))).resolves.toBe('provider result');

    const ledger = await db.query('SELECT estimated_cost_usd::float8 FROM api_usage_ledger');
    expect(ledger.rows).toEqual([{ estimated_cost_usd: 1.1 }]);
    await expect(assertDailyBudgetAvailable(db)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('reserves and settles as the server role while denying public spend access', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query('SELECT * FROM api_usage_reservations')).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('TRUNCATE api_usage_budget_days')).rejects.toMatchObject({ code: '42501' });
      await expect(assertDailyBudgetAvailable(db)).rejects.toMatchObject({ code: '42501' });
      await expect(withBudgetedUsage(db, usageRequest(role), async () => completedUsage)).rejects.toMatchObject({ code: '42501' });
      await db.exec('RESET ROLE');
    }

    await db.exec('SET ROLE service_role');
    await expect(withBudgetedUsage(db, usageRequest('service'), async () => completedUsage)).resolves.toBe('provider result');
    await expect(assertDailyBudgetAvailable(db, 0.4)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
