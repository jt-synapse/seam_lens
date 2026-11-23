import { toVectorLiteral, type Queryable } from '@/lib/db';
import type { CanonicalRegionTexts } from '@/modules/taxonomy/canonical-serializer';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import type { RegionVectors } from '@/modules/vision/types';
import type { PreparedGalleryView } from './chunk-worker';
import type { NormalizedImportDraft, RawSizeBandCandidate } from './parsers';

export type ExtractedView = {
  view: PreparedGalleryView;
  profile: ConstructionProfileV1;
  confidence: number;
  partialVisibility: boolean;
  texts: CanonicalRegionTexts;
  vectors: RegionVectors;
  embeddingModel?: string;
};

function validBounds(band: RawSizeBandCandidate, category: string) {
  const { bustMinIn, bustMaxIn, hipMinIn, hipMaxIn } = band;
  const validBust = bustMinIn !== null && bustMaxIn !== null &&
    bustMinIn >= 20 && bustMinIn <= 90 && bustMaxIn >= bustMinIn && bustMaxIn <= 95;
  const validHips = hipMinIn !== null && hipMaxIn !== null &&
    hipMinIn >= 20 && hipMinIn <= 95 && hipMaxIn >= hipMinIn && hipMaxIn <= 100;
  return validBust && (validHips || (category === 'top' && hipMinIn === null && hipMaxIn === null));
}

async function storeBand(tx: Queryable, makerId: string, patternId: string, band: RawSizeBandCandidate) {
  // Match both durable identities. A renamed band can keep its external ID and a
  // previously anonymous CSV band can acquire an ID without changing its row.
  const { rows } = await tx.query<{ id: string; external_product_id: string | null }>(
    `SELECT id, external_product_id FROM pattern_size_bands
      WHERE pattern_id = $1 AND (band_label = $2 OR external_product_id = $3)
      FOR UPDATE`,
    [patternId, band.bandLabel, band.externalProductId]
  );
  const previousId = rows[0]?.external_product_id;
  if (rows.length > 1 || (previousId && band.externalProductId && previousId !== band.externalProductId)) {
    throw new Error('Conflicting size-band identities');
  }
  await tx.query(
    `INSERT INTO pattern_size_bands (
        id, pattern_id, maker_id, external_product_id, band_label, is_default, product_url, price_cents,
        currency, designer_size_label, bust_min_in, bust_max_in, hip_min_in, hip_max_in
     ) VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET
       external_product_id = excluded.external_product_id, band_label = excluded.band_label,
       is_default = excluded.is_default, product_url = excluded.product_url, price_cents = excluded.price_cents,
       currency = excluded.currency, designer_size_label = excluded.designer_size_label,
       bust_min_in = excluded.bust_min_in, bust_max_in = excluded.bust_max_in,
       hip_min_in = excluded.hip_min_in, hip_max_in = excluded.hip_max_in`,
    [rows[0]?.id ?? null, patternId, makerId, band.externalProductId ?? previousId ?? null,
      band.bandLabel, band.isDefault, band.productUrl, band.priceCents, band.currency, band.designerSizeLabel,
      band.bustMinIn, band.bustMaxIn, band.hipMinIn, band.hipMaxIn]
  );
}

async function storeView(tx: Queryable, patternId: string, extracted: ExtractedView, isPrimary: boolean) {
  const { view, profile, texts, vectors, confidence } = extracted;
  const cover = view.images.find(image => image.role === 'cover') ?? view.images[0];
  const front = view.images.find(image => image.role === 'flat_front');
  const back = view.images.find(image => image.role === 'flat_back');
  await tx.query(
    `INSERT INTO pattern_views (
        pattern_id, view_code, view_label, garment_category, is_primary_view, cover_image_path,
        flat_front_image_path, flat_back_image_path, construction_profile, canonical_texts,
        vec_full, vec_bodice, vec_sleeves, vec_skirt, ai_confidence, embedding_model
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (pattern_id, view_code) DO UPDATE SET
       view_label = excluded.view_label, garment_category = excluded.garment_category,
       is_primary_view = excluded.is_primary_view, cover_image_path = excluded.cover_image_path,
       flat_front_image_path = excluded.flat_front_image_path, flat_back_image_path = excluded.flat_back_image_path,
       construction_profile = excluded.construction_profile, canonical_texts = excluded.canonical_texts,
       vec_full = excluded.vec_full, vec_bodice = excluded.vec_bodice, vec_sleeves = excluded.vec_sleeves,
       vec_skirt = excluded.vec_skirt, embedding_model = excluded.embedding_model,
       ai_confidence = excluded.ai_confidence, updated_at = now()`,
    [patternId, view.viewCode, view.viewLabel, profile.garment_category, isPrimary,
      cover.cardPath, front?.fullPath ?? null, back?.fullPath ?? null, JSON.stringify(profile),
      JSON.stringify(texts), toVectorLiteral(vectors.full), toVectorLiteral(vectors.bodice),
      toVectorLiteral(vectors.sleeves), toVectorLiteral(vectors.skirt), confidence, extracted.embeddingModel ?? null]
  );
}

export async function persistDraft(
  tx: Queryable, makerId: string, slug: string, draft: NormalizedImportDraft, views: ExtractedView[]
) {
  const first = views[0].profile;
  const categories = new Set(views.map(view => view.profile.garment_category));
  const category = draft.garmentCategoryHint ?? (categories.size > 1 ? 'dress_and_top_set' : first.garment_category);
  const flags: string[] = [];
  if (!draft.sizeBands.length || draft.sizeBands.some(band => !validBounds(band, category))) flags.push('missing_measurements');
  if (views.some(view => view.confidence < 0.8)) flags.push('low_confidence');
  if (views.some(view => view.partialVisibility)) flags.push('partial_visibility');
  if (!draft.skillHint) flags.push('missing_skill_level');

  // Serialize first imports from different batches, including designs sharing a maker-scoped external ID.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [makerId]);
  const externalIds = draft.sizeBands.flatMap(band => band.externalProductId ? [band.externalProductId] : []);
  const { rows: matches } = await tx.query<{ id: string; status: string; has_merged_offers: boolean }>(
    `WITH matches AS (
       SELECT COALESCE(p.merged_into_pattern_id, p.id) AS canonical_id
       FROM patterns p WHERE p.maker_id = $1 AND
         (p.slug = $2 OR EXISTS (
           SELECT 1 FROM pattern_size_bands b WHERE b.pattern_id = p.id AND b.external_product_id = ANY($3::text[])
         ) OR EXISTS (
           SELECT 1 FROM ingestion_items i
            WHERE i.pattern_id = p.id AND i.stage = 'ready_for_review'
              AND (i.external_ref = $4 OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(i.raw_payload->'sizeBands') = 'array'
                       THEN i.raw_payload->'sizeBands' ELSE '[]'::jsonb END
                ) candidate WHERE candidate->>'externalProductId' = ANY($3::text[])
              ))
         ))
     )
     SELECT p.id, p.status,
            EXISTS (SELECT 1 FROM patterns old WHERE old.merged_into_pattern_id = p.id) AS has_merged_offers
       FROM patterns p WHERE p.id IN (SELECT canonical_id FROM matches) FOR UPDATE OF p`,
    [makerId, slug, externalIds, draft.groupKey]
  );
  if (matches.length > 1) throw new Error('Import matches multiple designs and requires curator review');
  const previous = matches[0];
  if (previous) {
    const { rows } = await tx.query<{ human_verified: boolean }>(
      'SELECT human_verified FROM pattern_views WHERE pattern_id = $1 FOR UPDATE', [previous.id]
    );
    if (previous.status !== 'draft' || previous.has_merged_offers || rows.some(view => view.human_verified)) {
      // The editor includes the incoming raw fields even when catalog data is
      // preserved. Invalidate forms loaded before this new source was recorded.
      await tx.query('UPDATE pattern_views SET updated_at=clock_timestamp() WHERE pattern_id=$1', [previous.id]);
      return { patternId: previous.id, flags: [...flags, 'curated_reimport'] };
    }
  }

  const values = [draft.title, category, draft.substrateHint ?? first.substrate_compatibility,
    draft.formatsHint, draft.skillHint ?? 'intermediate'];
  const { rows: [pattern] } = previous
    ? await tx.query<{ id: string }>(
      `UPDATE patterns SET title = $1, garment_category = $2, substrate_type = $3, formats = $4,
          skill_level = $5, updated_at = now() WHERE id = $6 RETURNING id`, [...values, previous.id]
    )
    : await tx.query<{ id: string }>(
      `INSERT INTO patterns (title, garment_category, substrate_type, formats, skill_level, maker_id, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [...values, makerId, slug]
    );
  for (const band of draft.sizeBands) {
    if (validBounds(band, category)) await storeBand(tx, makerId, pattern.id, band);
  }
  for (const [index, view] of views.entries()) {
    await storeView(tx, pattern.id, view, index === 0);
  }
  return { patternId: pattern.id, flags };
}
