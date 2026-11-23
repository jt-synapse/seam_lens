import { getDbPool } from '@/lib/db';
import { startArchetypeSession } from '@/modules/catalog/archetypes-repo';
import { analyzeAndSearch } from '@/modules/search/analyze-service';
import { executeLoggedSessionSearch } from '@/modules/search/hybrid-ranker';
import { admitPublicSearch, publicSearchError, readAnalyzeRequest } from '@/modules/search/public-http';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { createGeminiVisionExtractor } from '@/modules/vision/gemini-vision-extractor';
import { assertDailyBudgetAvailable } from '@/modules/vision/usage-ledger';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const startedAt = performance.now();
    const input = await readAnalyzeRequest(request);
    const db = getDbPool();
    await admitPublicSearch(db, request, input.source !== 'archetype');
    if (input.source === 'archetype') {
      const session = await startArchetypeSession(db, input.archetypeSlug);
      return Response.json(await executeLoggedSessionSearch(db, session.id,
        input.focusRegion ?? session.defaultFocusRegion, input.filters, 'archetype', startedAt));
    }
    const result = await analyzeAndSearch({
      db,
      visionExtractor: {
        async extract(args) {
          await assertDailyBudgetAvailable(db);
          return createGeminiVisionExtractor(db).extract(args);
        },
      },
      textEmbedder: { embedRegions: (...args) => createGeminiTextEmbedder(db).embedRegions(...args) },
    }, { ...input, focusRegion: input.focusRegion ?? 'full_silhouette' });
    return Response.json(result);
  } catch (error) {
    return publicSearchError(error);
  }
}
