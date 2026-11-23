ALTER TABLE ingestion_items
  ADD COLUMN claim_token uuid,
  ADD COLUMN claim_expires_at timestamptz,
  ADD COLUMN review_flags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN item_key text,
  ADD CONSTRAINT ingestion_claim_pair CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL));

-- Preserve every historical row even when an older importer repeated its reference.
WITH ranked AS (
  SELECT id, external_ref, row_number() OVER (PARTITION BY batch_id, external_ref ORDER BY id) AS occurrence
  FROM ingestion_items
)
UPDATE ingestion_items i SET item_key = CASE WHEN occurrence = 1 THEN 'ref:' || ranked.external_ref
                                             ELSE 'legacy:' || i.id::text END
FROM ranked WHERE i.id = ranked.id;

ALTER TABLE ingestion_items ALTER COLUMN item_key SET NOT NULL,
  ADD CONSTRAINT ingestion_items_batch_key UNIQUE (batch_id, item_key);
CREATE INDEX ingestion_items_claimable ON ingestion_items (batch_id, claim_expires_at, id) WHERE stage = 'queued';

-- Old workers recorded intermediate stages without a resumable claim. Replay their
-- retained input through the atomically committing worker.
UPDATE ingestion_items SET stage = 'queued', updated_at = now()
 WHERE stage IN ('media_synced', 'vision_extracted');

CREATE INDEX ingestion_items_design_history ON ingestion_items (pattern_id)
 WHERE stage = 'ready_for_review' AND pattern_id IS NOT NULL;

-- Supabase serves approved gallery renditions from this public read bucket.
-- Standalone PostgreSQL installs have no Storage schema.
DO $bucket$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('catalog-media', 'catalog-media', true)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$bucket$;
