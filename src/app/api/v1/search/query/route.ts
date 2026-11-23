import { getDbPool } from '@/lib/db';
import { executeLoggedSessionSearch } from '@/modules/search/hybrid-ranker';
import { admitPublicSearch, publicSearchError, readQueryRequest } from '@/modules/search/public-http';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const startedAt = performance.now();
    const { querySessionId, focusRegion, filters } = await readQueryRequest(request);
    const db = getDbPool();
    await admitPublicSearch(db, request, false);
    return Response.json(await executeLoggedSessionSearch(db, querySessionId,
      focusRegion ?? 'full_silhouette', filters, 'filter_refinement', startedAt));
  } catch (error) {
    return publicSearchError(error);
  }
}
