import { getDbPool } from '@/lib/db';
import { isLocalDemo } from '@/lib/local-demo';
import { startArchetypeSession } from '@/modules/catalog/archetypes-repo';
import { analyzeAndSearch } from '@/modules/search/analyze-service';
import { executeLoggedSessionSearch } from '@/modules/search/hybrid-ranker';
import { admitPublicSearch, publicSearchError, readAnalyzeRequest } from '@/modules/search/public-http';
import { createTextEmbedder, createVisionExtractor } from '@/modules/vision/production';
import { assertDailyBudgetAvailable } from '@/modules/vision/usage-ledger';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const startedAt = performance.now();
    const input = await readAnalyzeRequest(request);
    const db = getDbPool();
    await admitPublicSearch(db, request, input.source !== 'archetype');
    if (Math.random() < 0.01) {
      await db.query(`DELETE FROM query_sessions WHERE id IN (
        SELECT id FROM query_sessions WHERE expires_at <= now()
        ORDER BY expires_at LIMIT 256 FOR UPDATE SKIP LOCKED
      )`);
    }
    if (input.source === 'archetype') {
      const session = await startArchetypeSession(db, input.archetypeSlug);
      return Response.json(await executeLoggedSessionSearch(db, session.id,
        input.focusRegion ?? session.defaultFocusRegion, input.filters, 'archetype', startedAt));
    }
    const result = await analyzeAndSearch({
      db,
      visionExtractor: {
        async extract(args) {
          if (!isLocalDemo()) await assertDailyBudgetAvailable(db);
          return createVisionExtractor(db).extract(args);
        },
      },
      textEmbedder: { embedRegions: (...args) => createTextEmbedder(db).embedRegions(...args) },
    }, { ...input, focusRegion: input.focusRegion ?? 'full_silhouette' }, startedAt);
    return Response.json(result);
  } catch (error) {
    return publicSearchError(error);
  }
}
