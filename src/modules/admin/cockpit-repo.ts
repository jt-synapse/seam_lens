import { z } from 'zod';
import { withTransaction, type Queryable } from '@/lib/db';
import type { NormalizedImportDraft, RawSizeBandCandidate } from '@/modules/ingestion/parsers';
import type { ConstructionProfileV1, DeliveryFormat, SkillLevel, SubstrateCompatibility } from '@/modules/taxonomy/construction-profile';

export type Maker = {
  id: string; slug: string; name: string; storefront_url: string; platform_type: string;
  vetted_status: string; permission_evidence_note: string | null; utm_campaign_slug: string;
  affiliate_query_param: string | null; revision: string;
};

export async function listMakers(db: Queryable) {
  return (await db.query<Maker>(`SELECT id, slug, name, storefront_url, platform_type, vetted_status,
    permission_evidence_note, utm_campaign_slug, affiliate_query_param, updated_at::text AS revision
    FROM makers ORDER BY name, id`)).rows;
}

const makerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  storefront_url: z.string().url().max(2048).refine(value => {
    const url = URL.canParse(value) ? new URL(value) : null;
    return url?.protocol === 'https:' && !url.username && !url.password;
  }, 'Enter an HTTPS storefront URL'),
  platform_type: z.enum(['shopify','woocommerce','custom']),
  vetted_status: z.enum(['pending','approved','suspended']),
  permission_evidence_note: z.string().trim().max(4000).optional(),
  utm_campaign_slug: z.string().trim().min(1).max(160),
  affiliate_query_param: z.string().trim().max(1024).optional(),
});

export async function saveMaker(db: Queryable, form: FormData) {
  const maker = makerSchema.parse(Object.fromEntries(form));
  if (maker.vetted_status === 'approved' && !maker.permission_evidence_note) {
    throw new Error('Record opt-in permission before approving this maker.');
  }
  const values = [maker.name, maker.slug, maker.storefront_url, maker.platform_type, maker.vetted_status,
    maker.permission_evidence_note || null, maker.utm_campaign_slug, maker.affiliate_query_param || null];
  if (form.get('id')) {
    const id = z.string().uuid().parse(form.get('id'));
    const { rows } = await db.query(`UPDATE makers SET name=$1, slug=$2, storefront_url=$3, platform_type=$4,
      vetted_status=$5, permission_evidence_note=$6, utm_campaign_slug=$7, affiliate_query_param=$8,
      updated_at=clock_timestamp() WHERE id=$9 AND updated_at=$10::timestamptz RETURNING id`,
      [...values,id,form.get('revision')]);
    if (!rows.length) throw new Error('This maker changed. Reload the directory before saving.');
    return;
  }
  await db.query(`INSERT INTO makers (name, slug, storefront_url, platform_type, vetted_status,
    permission_evidence_note, utm_campaign_slug, affiliate_query_param) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, values);
}

type QueueView = { id: string; title: string; view_label: string; maker_name: string; status: string;
  human_verified: boolean; confidence: number | null; flags: string[]; cover_image_path: string };

export async function listQueue(db: Queryable) {
  return (await db.query<QueueView>(`SELECT v.id, p.title, v.view_label, m.name AS maker_name, p.status,
    v.human_verified, v.ai_confidence::float8 AS confidence, v.cover_image_path,
    ARRAY(SELECT DISTINCT flag FROM unnest(
      ARRAY(SELECT unnest(i.review_flags) FROM ingestion_items i WHERE i.pattern_id=p.id)
      || CASE WHEN v.ai_confidence < 0.80 AND NOT v.human_verified THEN ARRAY['low_confidence'] ELSE '{}'::text[] END
      || CASE WHEN NOT EXISTS (SELECT 1 FROM pattern_size_bands b WHERE b.pattern_id=p.id)
         OR EXISTS (SELECT 1 FROM pattern_size_bands b WHERE b.pattern_id=p.id AND
           (b.bust_min_in IS NULL OR b.bust_max_in IS NULL OR
           ((p.garment_category <> 'top' OR (b.hip_min_in IS NULL) <> (b.hip_max_in IS NULL))
             AND (b.hip_min_in IS NULL OR b.hip_max_in IS NULL))))
         THEN ARRAY['missing_measurements'] ELSE '{}'::text[] END
    ) AS flag ORDER BY flag) AS flags
    FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id JOIN makers m ON m.id=p.maker_id
    WHERE p.merged_into_pattern_id IS NULL
    ORDER BY cardinality(ARRAY(SELECT unnest(i.review_flags) FROM ingestion_items i WHERE i.pattern_id=p.id)) > 0 DESC,
      v.human_verified, v.ai_confidence ASC NULLS LAST, p.title, v.view_code`)).rows;
}

export type EditableBand = { [K in keyof RawSizeBandCandidate]: RawSizeBandCandidate[K] } & { id?: string };
type EditorView = {
  id: string; pattern_id: string; maker_id: string; title: string; view_label: string; maker_name: string;
  status: string; human_verified: boolean; confidence: number | null; cover_image_path: string;
  flat_front_image_path: string | null; flat_back_image_path: string | null; revision: string;
  construction_profile: ConstructionProfileV1; substrate_type: SubstrateCompatibility; skill_level: SkillLevel;
  formats: DeliveryFormat[]; garment_category: string;
};
type Source = {source_descriptor: string; raw_payload: Partial<NormalizedImportDraft>; review_flags: string[]};
type MergeTarget = {id: string; title: string};

export async function getEditor(db: Queryable, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return withTransaction(db, async tx => {
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return loadEditor(tx, id);
  });
}

async function loadEditor(db: Queryable, id: string) {
  const { rows: [view] } = await db.query<EditorView>(`SELECT v.id, p.id AS pattern_id, p.maker_id, p.title, v.view_label,
    m.name AS maker_name, p.status, v.human_verified, v.ai_confidence::float8 AS confidence, v.cover_image_path,
    v.flat_front_image_path,v.flat_back_image_path,v.updated_at::text AS revision,v.construction_profile,
    p.substrate_type,p.skill_level,p.formats,p.garment_category
    FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id JOIN makers m ON m.id=p.maker_id
    WHERE v.id=$1 AND p.merged_into_pattern_id IS NULL`, [id]);
  if (!view) return null;
  const {rows: bands} = await db.query<EditableBand>(`SELECT id,external_product_id AS "externalProductId",band_label AS "bandLabel",
      is_default AS "isDefault",product_url AS "productUrl",price_cents AS "priceCents",currency,
      designer_size_label AS "designerSizeLabel",bust_min_in::float8 AS "bustMinIn",
      bust_max_in::float8 AS "bustMaxIn",hip_min_in::float8 AS "hipMinIn",hip_max_in::float8 AS "hipMaxIn"
      FROM pattern_size_bands WHERE pattern_id=$1 ORDER BY is_default DESC,band_label`, [view.pattern_id]);
  const {rows: sources} = await db.query<Source>(`SELECT b.source_descriptor,i.raw_payload,i.review_flags
      FROM ingestion_items i JOIN ingestion_batches b ON b.id=i.batch_id
      WHERE i.pattern_id=$1 ORDER BY b.created_at DESC,i.id`, [view.pattern_id]);
  const {rows: targets} = await db.query<MergeTarget>(`SELECT id,title FROM patterns WHERE maker_id=$1 AND id<>$2
      AND merged_into_pattern_id IS NULL AND status <> 'takedown' ORDER BY title`, [view.maker_id,view.pattern_id]);
  for (const source of sources) {
    if (view.human_verified && !source.review_flags.length) continue;
    for (const raw of source.raw_payload.sizeBands ?? []) {
      const matched = bands.find(saved => {
        if (!raw.externalProductId) return saved.bandLabel === raw.bandLabel;
        if (saved.externalProductId) return saved.externalProductId === raw.externalProductId;
        return saved.bandLabel === raw.bandLabel && saved.productUrl === raw.productUrl;
      });
      if (!matched) {
        bands.push({...raw});
      } else if (!matched.externalProductId && raw.externalProductId) {
        matched.externalProductId = raw.externalProductId;
      }
    }
  }
  return {view,bands,sources,targets};
}

export type Batch = { id: string; maker_name: string; source_descriptor: string; status: string; total_items: number;
  completed_items: number; failed_items: number; vetted_status: string };
export type BatchItem = {id: string; title: string; stage: string; attempts: number; error_message: string | null; view_id: string | null};

export async function listBatches(db: Queryable) {
  return (await db.query<Batch>(`SELECT b.id,m.name AS maker_name,m.vetted_status,b.source_descriptor,b.status,
    b.total_items,b.completed_items,b.failed_items FROM ingestion_batches b JOIN makers m ON m.id=b.maker_id
    ORDER BY b.created_at DESC,b.id`)).rows;
}

export async function listBatchItems(db: Queryable, batchId: string) {
  return (await db.query<BatchItem>(`SELECT i.id,coalesce(nullif(i.raw_payload->>'title',''),i.external_ref) AS title,
    i.stage,i.attempts,i.error_message,(SELECT v.id FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id
    WHERE v.pattern_id=i.pattern_id AND p.merged_into_pattern_id IS NULL ORDER BY v.is_primary_view DESC,v.view_code LIMIT 1) AS view_id
    FROM ingestion_items i WHERE i.batch_id=$1 ORDER BY title,i.id`, [batchId])).rows;
}
