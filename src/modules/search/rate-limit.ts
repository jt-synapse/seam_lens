import type { Queryable } from '@/lib/db';

export async function enforceRateLimit(
  db: Queryable,
  ipHash: string,
  bucket: 'analyze_min' | 'analyze_hr' | 'query_min',
  limit: number,
  windowSec: number,
  now?: Date,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  if (!ipHash || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowSec) || windowSec < 1) {
    throw new RangeError('Invalid rate-limit subject, limit or window');
  }
  const { rows } = await db.query<{ allowed: boolean; retry_after_sec: number }>(
    `WITH clock AS (
       SELECT coalesce($5::timestamptz, statement_timestamp()) AS now
     ), bounds AS (
       SELECT now, to_timestamp(floor(extract(epoch FROM now) / $4) * $4) AS start FROM clock
     ), admitted AS (
       INSERT INTO rate_limit_windows (bucket, subject_hash, window_start)
       SELECT $1, $2, start FROM bounds
       ON CONFLICT (bucket, subject_hash, window_start) DO UPDATE
         SET hit_count = rate_limit_windows.hit_count + 1
         WHERE rate_limit_windows.hit_count < $3
       RETURNING 1
     )
     SELECT EXISTS (SELECT FROM admitted) AS allowed,
            ceil($4 - extract(epoch FROM now - start))::int AS retry_after_sec FROM bounds`,
    [bucket, ipHash, limit, windowSec, now?.toISOString() ?? null],
  );
  return { allowed: rows[0].allowed, retryAfterSec: rows[0].allowed ? 0 : rows[0].retry_after_sec };
}
