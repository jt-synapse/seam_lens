import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { enforceRateLimit } from '@/modules/search/rate-limit';

it('atomically caps a burst per subject and bucket and resets on the fixed boundary', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE rate_limit_windows(bucket text, subject_hash text, window_start timestamptz, hit_count integer DEFAULT 1, PRIMARY KEY(bucket, subject_hash, window_start))');
    const now = new Date('2026-10-20T09:59:58.250Z');
    const burst = await Promise.all(Array.from({ length: 12 }, () =>
      enforceRateLimit(db, 'one', 'analyze_min', 3, 60, now)));
    expect(burst.filter(result => result.allowed)).toHaveLength(3);
    expect(burst.filter(result => !result.allowed)).toEqual(Array(9).fill({ allowed: false, retryAfterSec: 2 }));
    expect((await enforceRateLimit(db, 'two', 'analyze_min', 3, 60, now)).allowed).toBe(true);
    expect((await enforceRateLimit(db, 'one', 'analyze_hr', 1, 3600, now)).allowed).toBe(true);
    expect(await enforceRateLimit(db, 'one', 'analyze_hr', 1, 3600, now)).toEqual({ allowed: false, retryAfterSec: 2 });
    const reset = new Date('2026-10-20T10:00:00Z');
    expect((await enforceRateLimit(db, 'one', 'analyze_min', 3, 60, reset)).allowed).toBe(true);
    expect((await enforceRateLimit(db, 'one', 'analyze_hr', 1, 3600, reset)).allowed).toBe(true);
    expect((await enforceRateLimit(db, 'three', 'query_min', 1, 60)).allowed).toBe(true);
  } finally {
    await db.close();
  }
});
