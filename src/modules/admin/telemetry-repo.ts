import type { Queryable } from '@/lib/db';
import { getDailyAiBudgetUsd } from '@/lib/env';
import { requireAdminUser } from './auth';

export interface TelemetrySummary {
  searches: number;
  clicks: number;
  outboundCtr: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  perMakerClicks: { makerId: string; makerName: string; clicks: number }[];
  dailySpendUsd: number;
  dailyRequests: number;
  dailyBudgetUsd: number;
}

export async function getTelemetrySummary(db: Queryable, windowDays: 7 | 30): Promise<TelemetrySummary> {
  await requireAdminUser(db);
  if (windowDays !== 7 && windowDays !== 30) throw new Error('Select a 7- or 30-day reporting window.');
  const { rows: [row] } = await db.query<Omit<TelemetrySummary, 'outboundCtr' | 'dailyBudgetUsd'>>(
    `WITH window_start AS (SELECT now() - make_interval(days => $1) AS cutoff),
      maker_clicks AS (
        SELECT m.id, m.name, count(*)::float8 AS clicks
          FROM outbound_clicks c JOIN makers m ON m.id = c.maker_id, window_start
         WHERE c.created_at >= cutoff AND c.created_at <= now() GROUP BY m.id, m.name
      ),
      today_usage AS (
        SELECT COALESCE(sum(estimated_cost_usd), 0)::float8 AS spend,
               COALESCE(sum(request_count), 0)::float8 AS requests
          FROM api_usage_ledger WHERE usage_date = (now() AT TIME ZONE 'UTC')::date
      )
      SELECT count(*)::float8 AS searches,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY latency_ms) AS "p50LatencyMs",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS "p95LatencyMs",
             (SELECT COALESCE(sum(clicks), 0) FROM maker_clicks) AS clicks,
             (SELECT COALESCE(json_agg(json_build_object('makerId', id, 'makerName', name, 'clicks', clicks)
                       ORDER BY clicks DESC, name, id), '[]') FROM maker_clicks) AS "perMakerClicks",
             (SELECT spend FROM today_usage) AS "dailySpendUsd",
             (SELECT requests FROM today_usage) AS "dailyRequests"
        FROM search_events, window_start WHERE created_at >= cutoff AND created_at <= now()`, [windowDays],
  );
  return { ...row, outboundCtr: row.searches ? row.clicks / row.searches : 0, dailyBudgetUsd: getDailyAiBudgetUsd() };
}
