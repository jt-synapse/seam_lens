import { z } from 'zod';
import { withTransaction, toVectorLiteral, type Queryable } from '@/lib/db';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import {
  ConstructionProfileV1Schema, SubstrateCompatibilitySchema, DeliveryFormatSchema, SkillLevelSchema,
} from '@/modules/taxonomy/construction-profile';
import type { TextEmbedder } from '@/modules/vision/types';
import { confirmAdminMembership, requireAdminUser } from './auth';

const sizeBand = z.object({
  id: z.string().uuid().optional(),
  externalProductId: z.string().trim().min(1).nullish(),
  bandLabel: z.string().trim().min(1),
  isDefault: z.boolean(),
  productUrl: z.string().url().refine(value => {
    const url = URL.canParse(value) ? new URL(value) : null;
    return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  }, 'Enter an HTTP or HTTPS product URL.'),
  priceCents: z.number().int().min(0).max(2147483647).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  designerSizeLabel: z.string().nullable(),
  bustMinIn: z.number().min(20).max(90).multipleOf(0.1),
  bustMaxIn: z.number().min(20).max(95).multipleOf(0.1),
  hipMinIn: z.number().min(20).max(95).multipleOf(0.1).nullable(),
  hipMaxIn: z.number().min(20).max(100).multipleOf(0.1).nullable(),
}).refine(b => b.bustMaxIn >= b.bustMinIn && (
  b.hipMinIn === null ? b.hipMaxIn === null : b.hipMaxIn !== null && b.hipMaxIn >= b.hipMinIn
), 'Enter a complete measurement range with the minimum first.');

export type SizeBandInput = z.infer<typeof sizeBand>;
const editSchema = z.object({
  viewId: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  constructionProfile: ConstructionProfileV1Schema,
  sizeBands: z.array(sizeBand).min(1),
  substrateType: SubstrateCompatibilitySchema,
  formats: z.array(DeliveryFormatSchema),
  skillLevel: SkillLevelSchema,
});
export type CurationInput = z.infer<typeof editSchema>;
export type CurationDeps = { db: Queryable; embedder: TextEmbedder };
const publishStatus = z.enum(['draft', 'published', 'unpublished', 'takedown']);
export type PatternPublishStatus = z.infer<typeof publishStatus>;

type Parent = { id: string; maker_id: string; garment_category: string; merged_into_pattern_id: string | null };
async function getEditableParent(db: Queryable, input: CurationInput, lock: boolean) {
  // Acquire the parent first in every catalog write path. The second statement
  // gets a fresh READ COMMITTED snapshot after any wait for the parent lock.
  const { rows: [parent] } = await db.query<Parent>(
    `SELECT p.id, p.maker_id, p.garment_category, p.merged_into_pattern_id FROM patterns p
       JOIN pattern_views v ON v.pattern_id = p.id WHERE v.id = $1 ${lock ? 'FOR UPDATE OF p' : ''}`,
    [input.viewId],
  );
  if (!parent || parent.merged_into_pattern_id) throw new Error('This pattern is no longer available to edit.');
  const { rows: [view] } = await db.query<{ garment_category: string }>(
    `SELECT garment_category FROM pattern_views WHERE id = $1 AND pattern_id = $2
        AND updated_at = $3::timestamptz ${lock ? 'FOR UPDATE' : ''}`,
    [input.viewId, parent.id, input.expectedUpdatedAt],
  );
  if (!view) throw new Error('This pattern has changed. Reload the editor to review the latest version.');
  let category = parent.garment_category;
  if (view.garment_category !== input.constructionProfile.garment_category) {
    const { rows: [other] } = await db.query(`SELECT 1 FROM pattern_views WHERE pattern_id = $1
      AND id <> $2 AND garment_category <> $3 LIMIT 1`, [parent.id, input.viewId, input.constructionProfile.garment_category]);
    category = other ? 'dress_and_top_set' : input.constructionProfile.garment_category;
  }
  if (category !== 'top' && input.sizeBands.some(b => b.hipMinIn === null)) {
    throw new Error('Every dress size band requires hip measurements.');
  }
  return { ...parent, garment_category: category };
}

async function saveBands(tx: Queryable, parent: Parent, bands: SizeBandInput[]) {
  const { rows: existing } = await tx.query<{ id: string; band_label: string }>(
    'SELECT id, band_label FROM pattern_size_bands WHERE pattern_id = $1 FOR UPDATE', [parent.id],
  );
  const edits = new Map(bands.filter(b => b.id).map(b => [b.id, b]));
  if (edits.size !== existing.length || existing.some(b => !edits.has(b.id))) {
    throw new Error('Size bands have changed or belong to another pattern. Reload the editor.');
  }
  // Move renamed labels aside so two existing offerings can exchange names.
  const renamed = existing.filter(b => b.band_label !== edits.get(b.id)?.bandLabel);
  if (renamed.length) await tx.query(
    'UPDATE pattern_size_bands SET band_label = gen_random_uuid()::text WHERE id = ANY($1::uuid[])',
    [renamed.map(b => b.id)],
  );
  for (const band of bands) {
    await tx.query(`INSERT INTO pattern_size_bands (
        id, pattern_id, maker_id, external_product_id, band_label, is_default, product_url,
        price_cents, currency, designer_size_label, bust_min_in, bust_max_in, hip_min_in, hip_max_in)
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET
        external_product_id = COALESCE(pattern_size_bands.external_product_id, excluded.external_product_id),
        band_label = excluded.band_label, is_default = excluded.is_default,
        product_url = excluded.product_url, price_cents = excluded.price_cents, currency = excluded.currency,
        designer_size_label = excluded.designer_size_label, bust_min_in = excluded.bust_min_in,
        bust_max_in = excluded.bust_max_in, hip_min_in = excluded.hip_min_in, hip_max_in = excluded.hip_max_in`,
      [band.id ?? null, parent.id, parent.maker_id, band.externalProductId ?? null, band.bandLabel,
        band.isDefault, band.productUrl, band.priceCents, band.currency, band.designerSizeLabel,
        band.bustMinIn, band.bustMaxIn, band.hipMinIn, band.hipMaxIn],
    );
  }
}

// A label identifies anonymous CSV offerings. Different external IDs remain
// separate products even when their imports use the same default label.
const hasMissingRawBand = `EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(i.raw_payload->'sizeBands') = 'array'
           THEN i.raw_payload->'sizeBands' ELSE '[]'::jsonb END) raw
   WHERE NOT EXISTS (
     SELECT 1 FROM pattern_size_bands b WHERE b.pattern_id = i.pattern_id AND (
        b.external_product_id = raw->>'externalProductId'
        OR (b.band_label = raw->>'bandLabel' AND (
           raw->>'externalProductId' IS NULL
           OR (b.external_product_id IS NULL AND b.product_url = raw->>'productUrl')))
     )
   )
)`;

async function resolveReviewFlags(tx: Queryable, patternId: string) {
  await tx.query(`UPDATE ingestion_items i SET review_flags = ARRAY(
      SELECT flag FROM unnest(i.review_flags) flag
       WHERE CASE flag
        WHEN 'missing_skill_level' THEN false
        WHEN 'missing_measurements' THEN ${hasMissingRawBand}
        WHEN 'curated_reimport' THEN ${hasMissingRawBand} OR EXISTS (SELECT 1 FROM pattern_views v WHERE v.pattern_id = i.pattern_id
               AND (NOT v.human_verified OR v.verified_at IS NULL OR v.verified_at < i.updated_at))
        WHEN 'low_confidence' THEN EXISTS (SELECT 1 FROM pattern_views v WHERE v.pattern_id = i.pattern_id
               AND NOT v.human_verified AND v.ai_confidence < 0.8)
        WHEN 'partial_visibility' THEN EXISTS (SELECT 1 FROM pattern_views v WHERE v.pattern_id = i.pattern_id
               AND NOT v.human_verified)
        ELSE true END)
    WHERE i.pattern_id = $1 AND i.stage = 'ready_for_review' AND cardinality(i.review_flags) > 0`, [patternId]);
}

function documentVector(values: number[]) {
  const literal = toVectorLiteral(values);
  if (!literal || Math.abs(Math.hypot(...values) - 1) > 1e-5) throw new Error('Expected a unit document embedding.');
  return literal;
}

export async function savePatternViewCuration(deps: CurationDeps, input: CurationInput): Promise<void> {
  const admin = await requireAdminUser(deps.db);
  const edit = editSchema.parse(input);
  const bands = edit.sizeBands;
  const ids = bands.flatMap(b => b.id ? [b.id] : []);
  if (bands.filter(b => b.isDefault).length !== 1 || new Set(ids).size !== ids.length ||
      new Set(bands.map(b => b.bandLabel)).size !== bands.length) {
    throw new Error('Supply distinct size bands and select exactly one default.');
  }
  // The adapter reserves and settles ingest_embed before the short catalog transaction.
  await getEditableParent(deps.db, edit, false);
  const profile = edit.constructionProfile;
  const texts = serializeCanonicalRegions(profile);
  const { vectors } = await deps.embedder.embedRegions(texts, 'RETRIEVAL_DOCUMENT');
  if ((vectors.skirt === null) !== (texts.skirt_hemline === null)) throw new Error('Incorrect skirt embedding.');
  const vectorColumns = [documentVector(vectors.full), documentVector(vectors.bodice),
    documentVector(vectors.sleeves), vectors.skirt === null ? null : documentVector(vectors.skirt)];

  await withTransaction(deps.db, async tx => {
    await confirmAdminMembership(tx, admin.userId);
    const parent = await getEditableParent(tx, edit, true);
    await saveBands(tx, parent, bands);
    await tx.query(`UPDATE pattern_views SET construction_profile=$2, canonical_texts=$3,
        vec_full=$4::vector, vec_bodice=$5::vector, vec_sleeves=$6::vector, vec_skirt=$7::vector,
        human_verified=true, verified_by=$8, verified_at=greatest(clock_timestamp(), updated_at + interval '1 microsecond'),
        garment_category=$9 WHERE id=$1`,
      [edit.viewId, JSON.stringify(profile), JSON.stringify(texts), ...vectorColumns, admin.userId, profile.garment_category]);
    await tx.query(`UPDATE patterns SET substrate_type=$2, formats=$3, skill_level=$4, garment_category=$5
       WHERE id=$1`, [parent.id, edit.substrateType, edit.formats, edit.skillLevel, parent.garment_category]);
    await resolveReviewFlags(tx, parent.id);
  });
}

export async function setPatternPublishStatus(db: Queryable, patternId: string, status: PatternPublishStatus): Promise<void> {
  await requireAdminUser(db);
  publishStatus.parse(status);
  await withTransaction(db, async tx => {
    const { rows: [pattern] } = await tx.query(
      'SELECT id FROM patterns WHERE id = $1 AND merged_into_pattern_id IS NULL FOR UPDATE', [patternId],
    );
    if (!pattern) throw new Error('Pattern unavailable or already merged.');
    if (status === 'published') {
      const { rows } = await tx.query(`SELECT 1 FROM ingestion_items WHERE pattern_id=$1
        AND stage='ready_for_review' AND 'missing_measurements'=ANY(review_flags) LIMIT 1`, [patternId]);
      if (rows.length) throw new Error('Complete missing imported size-band measurements before publication.');
    }
    await tx.query('UPDATE patterns SET status=$2 WHERE id=$1', [patternId, status]);
  });
}

export async function mergeSizeBandIntoPattern(
  db: Queryable, sourcePatternId: string, targetPatternId: string, bandLabel: string,
): Promise<void> {
  await requireAdminUser(db);
  const label = z.string().trim().min(1).parse(bandLabel);
  if (sourcePatternId === targetPatternId) throw new Error('Choose two different patterns.');
  await withTransaction(db, async tx => {
    // Match the importer's lock order so an in-flight import resolves this merge on commit.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext(maker_id::text)) FROM patterns WHERE id=$1', [sourcePatternId]);
    const { rows } = await tx.query<Parent & {status: string}>(
      `SELECT id,maker_id,status,garment_category,merged_into_pattern_id FROM patterns
        WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[sourcePatternId, targetPatternId]],
    );
    const source = rows.find(p => p.id === sourcePatternId), target = rows.find(p => p.id === targetPatternId);
    if (!source || !target || source.maker_id !== target.maker_id || source.status !== 'draft' ||
        source.merged_into_pattern_id || target.merged_into_pattern_id || target.status === 'takedown') {
      throw new Error('Merge a duplicate draft into an available pattern from the same maker.');
    }
    const { rows: bands } = await tx.query<{ id: string; hip_min_in: string | null; hip_max_in: string | null }>(
      'SELECT id,hip_min_in,hip_max_in FROM pattern_size_bands WHERE pattern_id=$1 FOR UPDATE', [source.id],
    );
    if (bands.length !== 1 || (target.garment_category !== 'top' && (bands[0].hip_min_in === null || bands[0].hip_max_in === null))) {
      throw new Error('The source needs one complete size band for the target garment.');
    }
    const { rows: [unresolved] } = await tx.query(`SELECT 1 FROM ingestion_items i WHERE i.pattern_id=$1
      AND 'missing_measurements'=ANY(i.review_flags) AND ${hasMissingRawBand} LIMIT 1`, [source.id]);
    if (unresolved) throw new Error('Resolve the missing source size bands before merging.');
    await tx.query(`UPDATE pattern_size_bands SET pattern_id=$2, band_label=$3,
         is_default=NOT EXISTS (SELECT 1 FROM pattern_size_bands WHERE pattern_id=$2)
       WHERE id=$1`, [bands[0].id, target.id, label]);
    // Keep historical source rows, including views, intact. Flatten previous aliases.
    await tx.query('UPDATE patterns SET merged_into_pattern_id=$2 WHERE merged_into_pattern_id=$1', [source.id, target.id]);
    await tx.query("UPDATE patterns SET status='unpublished', merged_into_pattern_id=$2 WHERE id=$1", [source.id, target.id]);
    await tx.query('UPDATE patterns SET updated_at=clock_timestamp() WHERE id=$1', [target.id]);
  });
}
