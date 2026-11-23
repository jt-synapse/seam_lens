import { toVectorLiteral, type Queryable } from '@/lib/db';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import type { FocusRegion } from '@/modules/taxonomy/construction-profile';
import type { TextEmbedder, VisionExtractor } from '@/modules/vision/types';
import { executeLoggedSessionSearch, type SearchExecutionResult, type SearchFilters } from './hybrid-ranker';
import { fetchDirectImageUrlSafe, validateAndNormalizeServerImage, type CropBox } from './image-ingest';
import { SearchError } from './search-error';

export type AnalyzeDeps = {
  db: Queryable;
  visionExtractor: VisionExtractor;
  textEmbedder: TextEmbedder;
};

export type AnalyzeInput = (
  { source: 'upload'; bytes: Buffer } | { source: 'url'; imageUrl: string }
) & {
  cropBox?: CropBox | null;
  focusRegion: FocusRegion;
  filters: SearchFilters;
};

export async function analyzeAndSearch(deps: AnalyzeDeps, input: AnalyzeInput): Promise<SearchExecutionResult> {
  const startedAt = performance.now();
  const { db, visionExtractor, textEmbedder } = deps;
  const bytes = input.source === 'upload' ? input.bytes : await fetchDirectImageUrlSafe(input.imageUrl);
  const { webpBytes, sha256 } = await validateAndNormalizeServerImage(bytes, input.cropBox);
  const crop = input.cropBox;
  const cropBox = crop && (crop.x !== 0 || crop.y !== 0 || crop.width !== 1 || crop.height !== 1)
    ? JSON.stringify({ x: crop.x, y: crop.y, width: crop.width, height: crop.height })
    : null;

  const { rows: [cached] } = await db.query<{ id: string }>(
    `SELECT id FROM query_sessions
     WHERE image_sha256 = $1 AND crop_box IS NOT DISTINCT FROM $2::jsonb AND expires_at > now()
     ORDER BY created_at DESC, id
     LIMIT 1`,
    [sha256, cropBox],
  );
  if (cached) {
    return executeLoggedSessionSearch(db, cached.id, input.focusRegion, input.filters, input.source, startedAt);
  }

  const visionStartedAt = performance.now();
  const { status, profile, warnings } = await visionExtractor.extract({
    images: [{ mimeType: 'image/webp', bytes: webpBytes }],
    mode: 'live_query',
  });
  const visionMs = Math.round(performance.now() - visionStartedAt);

  if (status === 'unsupported_category_v1' && !profile) {
    throw new SearchError('UNSUPPORTED_CATEGORY_V1', 422, 'SeamLens Studio v1 searches dress and top sewing patterns.');
  }
  if (status === 'no_garment_detected' || !profile) {
    throw new SearchError('NO_GARMENT_DETECTED', 422, 'Choose an image with visible garment construction.');
  }

  const canonical = serializeCanonicalRegions(profile);
  const embedStartedAt = performance.now();
  const { vectors } = await textEmbedder.embedRegions(canonical, 'RETRIEVAL_QUERY');
  const embedMs = Math.round(performance.now() - embedStartedAt);

  const { rows: [{ id }] } = await db.query<{ id: string }>(
    `INSERT INTO query_sessions
       (image_sha256, crop_box, query_status, extracted_profile, canonical_texts,
        vec_full, vec_bodice, vec_sleeves, vec_skirt, warnings, vision_ms, embed_ms)
     VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::jsonb,
             $6::vector, $7::vector, $8::vector, $9::vector, $10, $11, $12)
     RETURNING id`,
    [sha256, cropBox, status, JSON.stringify(profile), JSON.stringify(canonical),
      toVectorLiteral(vectors.full), toVectorLiteral(vectors.bodice), toVectorLiteral(vectors.sleeves),
      toVectorLiteral(vectors.skirt), warnings, visionMs, embedMs],
  );

  if (Math.random() < 0.01) {
    await db.query('DELETE FROM query_sessions WHERE expires_at < now()');
  }

  return executeLoggedSessionSearch(db, id, input.focusRegion, input.filters, input.source, startedAt);
}
