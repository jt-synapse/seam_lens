import { createHash } from 'node:crypto';
import { withTransaction, type Queryable } from '@/lib/db';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import type { TextEmbedder, VisionExtractor } from '@/modules/vision/types';
import { catalogContext } from './catalog-context';
import { persistDraft, type ExtractedView } from './draft-persistence';
import type { NormalizedImportDraft } from './parsers';

export type PreparedGalleryView = {
  viewCode: string;
  viewLabel: string;
  images: Array<{
    role: 'cover' | 'flat_front' | 'flat_back';
    bytes: Buffer;
    mimeType: string;
    fullPath: string;
    cardPath: string;
  }>;
};

export type IngestionWorkerDeps = {
  db: Queryable;
  vision: VisionExtractor;
  embedder: TextEmbedder;
  prepareGallery(input: {
    draft: NormalizedImportDraft;
    makerSlug: string;
    patternSlug: string;
    assertActive: () => Promise<void>;
  }): Promise<PreparedGalleryView[]>;
};

type EnqueueParams = {
  makerId: string;
  sourceType: 'shopify_json' | 'csv_upload';
  sourceDescriptor: string;
  drafts: NormalizedImportDraft[];
  createdBy: string;
};

type Maker = { id: string; slug: string };
type Claim = { id: string; raw_payload: NormalizedImportDraft; claim_token: string };

async function lockApprovedMaker(tx: Queryable, makerId: string) {
  const { rows: [maker] } = await tx.query<Maker>(
    "SELECT id, slug FROM makers WHERE id = $1 AND vetted_status = 'approved' FOR SHARE",
    [makerId]
  );
  if (!maker) throw new Error('Maker must be approved for ingestion');
  return maker;
}

export async function enqueueIngestionBatch(db: Queryable, params: EnqueueParams) {
  return withTransaction(db, async (tx) => {
    await lockApprovedMaker(tx, params.makerId);
    const itemCount = params.drafts.length;
    const { rows: [batch] } = await tx.query<{ id: string }>(
      `INSERT INTO ingestion_batches (maker_id, source_type, source_descriptor, created_by, total_items, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [params.makerId, params.sourceType, params.sourceDescriptor, params.createdBy, itemCount,
        itemCount === 0 ? 'completed' : 'queued']
    );
    for (const draft of params.drafts) {
      await tx.query(
        `INSERT INTO ingestion_items (batch_id, external_ref, item_key, raw_payload)
         VALUES ($1, $2, 'ref:' || $2, $3)`,
        [batch.id, draft.groupKey, JSON.stringify(draft)]
      );
    }
    return { batchId: batch.id, itemCount };
  });
}

// For every transaction changing item stage or batch counts, lock the batch first.
// When permission is required, lock the maker next, then the item. No locks span AI calls.
async function lockBatch(tx: Queryable, batchId: string) {
  const { rows: [batch] } = await tx.query<{ maker_id: string }>(
    'SELECT maker_id FROM ingestion_batches WHERE id = $1 FOR UPDATE', [batchId]
  );
  if (!batch) throw new Error('Import batch does not exist');
  return batch;
}

async function refreshCounts(tx: Queryable, batchId: string) {
  const { rows: [batch] } = await tx.query<{ status: string }>(
    `UPDATE ingestion_batches b
        SET completed_items = c.done, failed_items = c.failed,
            status = CASE
              WHEN c.done + c.failed = b.total_items THEN CASE WHEN c.failed > 0 THEN 'failed' ELSE 'completed' END
              WHEN c.started THEN 'processing' ELSE 'queued' END
       FROM (SELECT count(*) FILTER (WHERE stage = 'ready_for_review') AS done,
                    count(*) FILTER (WHERE stage = 'failed') AS failed,
                    bool_or(claim_token IS NOT NULL OR stage <> 'queued') AS started
               FROM ingestion_items WHERE batch_id = $1) c
      WHERE b.id = $1 RETURNING status`,
    [batchId]
  );
  return batch.status;
}

export async function retryIngestionItem(db: Queryable, itemId: string) {
  return withTransaction(db, async (tx) => {
    const { rows: [item] } = await tx.query<{ batch_id: string }>(
      'SELECT batch_id FROM ingestion_items WHERE id = $1', [itemId]
    );
    if (!item) throw new Error('Import item does not exist');
    const batch = await lockBatch(tx, item.batch_id);
    await lockApprovedMaker(tx, batch.maker_id);
    const { rows } = await tx.query(
      `UPDATE ingestion_items SET stage = 'queued', error_message = NULL, updated_at = now()
        WHERE id = $1 AND batch_id = $2 AND stage = 'failed' RETURNING id`,
      [itemId, item.batch_id]
    );
    if (!rows.length) throw new Error('Only failed import items can be retried');
    return refreshCounts(tx, item.batch_id);
  });
}

async function claimItems(db: Queryable, batchId: string, size: number) {
  return withTransaction(db, async (tx) => {
    const batch = await lockBatch(tx, batchId);
    const maker = await lockApprovedMaker(tx, batch.maker_id);
    const { rows: items } = await tx.query<Claim>(
      `WITH candidates AS (
         SELECT id FROM ingestion_items
          WHERE batch_id = $1 AND stage = 'queued'
            AND (claim_token IS NULL OR claim_expires_at <= clock_timestamp())
          ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED
       )
       UPDATE ingestion_items i
          SET claim_token = gen_random_uuid(), claim_expires_at = clock_timestamp() + interval '2 minutes',
              attempts = attempts + 1, updated_at = now()
         FROM candidates c WHERE i.id = c.id
       RETURNING i.id, i.raw_payload, i.claim_token`,
      [batchId, size]
    );
    if (items.length) {
      await tx.query("UPDATE ingestion_batches SET status = 'processing' WHERE id = $1", [batchId]);
    }
    return { maker, items };
  });
}

async function renewClaim(db: Queryable, item: Claim, makerId: string) {
  const { rows } = await db.query(
    `UPDATE ingestion_items i SET claim_expires_at = clock_timestamp() + interval '2 minutes'
       FROM ingestion_batches b JOIN makers m ON m.id = b.maker_id
      WHERE i.batch_id = b.id AND i.id = $1 AND i.claim_token = $2 AND i.stage = 'queued'
        AND i.claim_expires_at > clock_timestamp() AND m.id = $3 AND m.vetted_status = 'approved'
      RETURNING i.id`,
    [item.id, item.claim_token, makerId]
  );
  if (!rows.length) throw new Error('Claim expired or maker is no longer approved');
}

async function extractViews(
  deps: IngestionWorkerDeps, item: Claim, maker: Maker, patternSlug: string
): Promise<ExtractedView[]> {
  const draft = item.raw_payload;
  const assertActive = () => renewClaim(deps.db, item, maker.id);
  await assertActive();
  const gallery = await deps.prepareGallery({ draft, makerSlug: maker.slug, patternSlug, assertActive });
  if (!gallery.length || new Set(gallery.map(view => view.viewCode)).size !== gallery.length) {
    throw new Error('Gallery requires distinct views');
  }
  const views: ExtractedView[] = [];
  for (const view of gallery) {
    const images = [...view.images].sort((a, b) => Number(a.role === 'cover') - Number(b.role === 'cover'));
    if (!images.length) throw new Error('View has no usable images');
    await assertActive();
    const result = await deps.vision.extract({
      images,
      mode: 'catalog_ingestion',
      contextText: catalogContext([draft.title, view.viewLabel, draft.descriptionHtml]),
    });
    if (!result.profile || result.status === 'unsupported_category_v1' || result.status === 'no_garment_detected') {
      throw new Error('Catalog extraction returned ' + result.status);
    }
    const texts = serializeCanonicalRegions(result.profile);
    await assertActive();
    const { vectors } = await deps.embedder.embedRegions(texts, 'RETRIEVAL_DOCUMENT');
    views.push({
      view, profile: result.profile, confidence: result.aiConfidence,
      partialVisibility: result.status === 'low_visibility_partial', texts, vectors,
    });
  }
  return views;
}

async function processItem(deps: IngestionWorkerDeps, batchId: string, item: Claim, maker: Maker) {
  try {
    const draft = item.raw_payload;
    const name = draft.groupKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    const hash = createHash('sha256').update(maker.id + '\0' + draft.groupKey).digest('hex').slice(0, 16);
    const patternSlug = `${name || 'pattern'}-${hash}`;
    const views = await extractViews(deps, item, maker, patternSlug);
    return await withTransaction(deps.db, async (tx) => {
      const batch = await lockBatch(tx, batchId);
      await lockApprovedMaker(tx, batch.maker_id);
      await renewClaim(tx, item, maker.id);
      const { patternId, flags } = await persistDraft(tx, maker.id, patternSlug, draft, views);
      await tx.query(
        `UPDATE ingestion_items SET pattern_id = $2, review_flags = $3, stage = 'ready_for_review',
             claim_token = NULL, claim_expires_at = NULL, error_message = NULL, updated_at = now()
          WHERE id = $1`,
        [item.id, patternId, flags]
      );
      await refreshCounts(tx, batchId);
      return 'completed';
    });
  } catch (error) {
    return withTransaction(deps.db, async (tx) => {
      await lockBatch(tx, batchId);
      const message = error instanceof Error ? error.message.slice(0, 512) : 'Ingestion failed';
      const { rows } = await tx.query(
        `UPDATE ingestion_items SET stage = 'failed', error_message = $3,
             claim_token = NULL, claim_expires_at = NULL, updated_at = now()
          WHERE id = $1 AND claim_token = $2 AND claim_expires_at > clock_timestamp()
          RETURNING id`,
        [item.id, item.claim_token, message]
      );
      if (!rows.length) return 'stale';
      await refreshCounts(tx, batchId);
      return 'failed';
    });
  }
}

export async function processNextIngestionChunk(deps: IngestionWorkerDeps, batchId: string, chunkSize = 3) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > 3) {
    throw new Error('Chunk size must be between 1 and 3');
  }
  const { maker, items } = await claimItems(deps.db, batchId, chunkSize);
  const outcomes = await Promise.all(items.map(item => processItem(deps, batchId, item, maker)));
  const { rows: [batch] } = await deps.db.query<{ status: string }>(
    'SELECT status FROM ingestion_batches WHERE id = $1', [batchId]
  );
  return {
    processed: items.length,
    completed: outcomes.filter(outcome => outcome === 'completed').length,
    failed: outcomes.filter(outcome => outcome === 'failed').length,
    status: batch.status,
  };
}
