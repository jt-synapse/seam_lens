-- SeamLens Studio v1 — Initial PostgreSQL 16 + pgvector Physical Schema
-- Authoritative basis: Spec §5.3

CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  END IF;
EXCEPTION
  WHEN undefined_file OR feature_not_supported THEN
    NULL;
END $$;

-- 1. Vetted Indie Pattern Houses
CREATE TABLE makers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  storefront_url TEXT NOT NULL,
  platform_type TEXT NOT NULL CHECK (platform_type IN ('shopify', 'woocommerce', 'custom')),
  vetted_status TEXT NOT NULL DEFAULT 'pending' CHECK (vetted_status IN ('pending', 'approved', 'suspended')),
  permission_evidence_note TEXT,
  utm_campaign_slug TEXT NOT NULL DEFAULT 'seamlens_v1',
  affiliate_query_param TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Canonical Patterns (Design-Level Garment Entity)
CREATE TABLE patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id UUID NOT NULL REFERENCES makers(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  garment_category TEXT NOT NULL CHECK (garment_category IN ('dress', 'top', 'dress_and_top_set')),
  substrate_type TEXT NOT NULL CHECK (substrate_type IN ('woven', 'knit', 'both')),
  formats TEXT[] NOT NULL DEFAULT '{}' CHECK (
    formats <@ ARRAY['pdf_a4_letter', 'pdf_a0', 'projector', 'paper_envelope']::TEXT[]
  ),
  skill_level TEXT NOT NULL CHECK (
    skill_level IN ('confident_beginner', 'intermediate', 'advanced_couture')
  ),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'published', 'unpublished', 'takedown')
  ),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2b. Pattern Size Bands / Commercial Offerings (1:N per Pattern)
CREATE TABLE pattern_size_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  maker_id UUID NOT NULL REFERENCES makers(id) ON DELETE CASCADE,
  external_product_id TEXT,
  band_label TEXT NOT NULL DEFAULT 'Standard',
  is_default BOOLEAN NOT NULL DEFAULT true,
  product_url TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  designer_size_label TEXT,
  bust_min_in NUMERIC(4,1) NOT NULL CHECK (bust_min_in BETWEEN 20.0 AND 90.0),
  bust_max_in NUMERIC(4,1) NOT NULL CHECK (bust_max_in >= bust_min_in AND bust_max_in <= 95.0),
  hip_min_in  NUMERIC(4,1) CHECK (hip_min_in BETWEEN 20.0 AND 95.0),
  hip_max_in  NUMERIC(4,1) CHECK (hip_max_in >= hip_min_in AND hip_max_in <= 100.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (maker_id, external_product_id),
  UNIQUE (pattern_id, band_label)
);

-- 3. Pattern Views (Searchable Construction Units, 1:N per Pattern)
CREATE TABLE pattern_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  view_code TEXT NOT NULL,
  view_label TEXT NOT NULL,
  garment_category TEXT NOT NULL CHECK (garment_category IN ('dress', 'top')),
  is_primary_view BOOLEAN NOT NULL DEFAULT false,
  cover_image_path TEXT NOT NULL,
  flat_front_image_path TEXT,
  flat_back_image_path TEXT,
  construction_profile JSONB NOT NULL,
  canonical_texts JSONB NOT NULL,
  vec_full    vector(768) NOT NULL,
  vec_bodice  vector(768) NOT NULL,
  vec_sleeves vector(768) NOT NULL,
  vec_skirt   vector(768),
  ai_confidence NUMERIC(3,2) CHECK (ai_confidence BETWEEN 0.00 AND 1.00),
  human_verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pattern_id, view_code)
);

-- 4. One-Click Curated Upload Dock Archetypes
CREATE TABLE curated_archetypes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  image_path TEXT NOT NULL,
  default_focus_region TEXT NOT NULL DEFAULT 'full_silhouette',
  extracted_profile JSONB NOT NULL,
  vec_full    vector(768) NOT NULL,
  vec_bodice  vector(768) NOT NULL,
  vec_sleeves vector(768) NOT NULL,
  vec_skirt   vector(768),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true
);

-- 5. Ephemeral Query Sessions (UNLOGGED, 30-Minute TTL, Zero Raw Image Bytes)
CREATE UNLOGGED TABLE query_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_sha256 TEXT NOT NULL,
  crop_box JSONB,
  query_status TEXT NOT NULL CHECK (
    query_status IN ('ok', 'unsupported_category_v1', 'low_visibility_partial')
  ),
  extracted_profile JSONB NOT NULL,
  canonical_texts JSONB NOT NULL,
  vec_full    vector(768) NOT NULL,
  vec_bodice  vector(768) NOT NULL,
  vec_sleeves vector(768) NOT NULL,
  vec_skirt   vector(768),
  warnings TEXT[] NOT NULL DEFAULT '{}',
  vision_ms INTEGER,
  embed_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes')
);

-- 6. Batch Ingestion Queue & Audit State
CREATE TABLE ingestion_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id UUID NOT NULL REFERENCES makers(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('shopify_json', 'csv_upload')),
  source_descriptor TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES ingestion_batches(id) ON DELETE CASCADE,
  external_ref TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  pattern_id UUID REFERENCES patterns(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'queued' CHECK (
    stage IN ('queued', 'media_synced', 'vision_extracted', 'ready_for_review', 'failed')
  ),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Search Telemetry, Outbound Click Attribution, Rate Limits & Cost Guardrails
CREATE TABLE search_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_session_id UUID,
  source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'url', 'archetype', 'filter_refinement')),
  focus_region TEXT NOT NULL,
  filters_applied JSONB NOT NULL,
  result_count INTEGER NOT NULL,
  top_pattern_ids UUID[] NOT NULL DEFAULT '{}',
  latency_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbound_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  size_band_id UUID REFERENCES pattern_size_bands(id) ON DELETE SET NULL,
  pattern_view_id UUID REFERENCES pattern_views(id) ON DELETE SET NULL,
  maker_id UUID NOT NULL REFERENCES makers(id) ON DELETE CASCADE,
  query_session_id UUID,
  rank_position INTEGER,
  focus_region TEXT,
  destination_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_usage_ledger (
  usage_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::DATE,
  operation TEXT NOT NULL CHECK (operation IN ('search_vision', 'search_embed', 'ingest_vision', 'ingest_embed')),
  request_count INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, operation)
);

CREATE TABLE admin_users (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('curator', 'engineer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rate_limit_windows (
  bucket TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, subject_hash, window_start)
);

-- Indexes: HNSW cosine indexes (m = 16, ef_construction = 64) + relational B-tree/GIN
CREATE INDEX idx_pattern_views_vec_full_hnsw
  ON pattern_views USING hnsw (vec_full vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_pattern_views_vec_bodice_hnsw
  ON pattern_views USING hnsw (vec_bodice vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_pattern_views_vec_sleeves_hnsw
  ON pattern_views USING hnsw (vec_sleeves vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_pattern_views_vec_skirt_hnsw
  ON pattern_views USING hnsw (vec_skirt vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE vec_skirt IS NOT NULL;

CREATE INDEX idx_patterns_status_substrate_skill
  ON patterns (status, substrate_type, skill_level);

CREATE INDEX idx_patterns_formats_gin
  ON patterns USING gin (formats);

CREATE INDEX idx_patterns_maker_id
  ON patterns (maker_id);

CREATE INDEX idx_makers_vetted_status
  ON makers (vetted_status);

CREATE INDEX idx_pattern_size_bands_bounds
  ON pattern_size_bands (pattern_id, bust_min_in, bust_max_in, hip_min_in, hip_max_in);

CREATE INDEX idx_pattern_views_pattern_id
  ON pattern_views (pattern_id);

CREATE INDEX idx_curated_archetypes_active_sort
  ON curated_archetypes (active, sort_order);

CREATE INDEX idx_query_sessions_sha256_expires
  ON query_sessions (image_sha256, expires_at);

CREATE INDEX idx_ingestion_items_batch_stage
  ON ingestion_items (batch_id, stage);

CREATE INDEX idx_search_events_created_at
  ON search_events (created_at);

CREATE INDEX idx_outbound_clicks_pattern_created
  ON outbound_clicks (pattern_id, created_at);

CREATE INDEX idx_outbound_clicks_maker_created
  ON outbound_clicks (maker_id, created_at);

-- Database-Enforced Publish Readiness Trigger
CREATE OR REPLACE FUNCTION enforce_pattern_publish_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_maker_status TEXT;
  v_has_valid_band BOOLEAN;
  v_has_valid_view BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  IF NEW.status = 'published' THEN
    SELECT m.vetted_status
      INTO v_maker_status
      FROM makers m
     WHERE m.id = NEW.maker_id;

    IF NOT FOUND OR v_maker_status <> 'approved' THEN
      RAISE EXCEPTION
        'Cannot publish pattern "%" (%): parent maker % must have vetted_status = approved (got %)',
        NEW.slug,
        NEW.id,
        NEW.maker_id,
        COALESCE(v_maker_status, 'missing');
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pattern_size_bands psb
       WHERE psb.pattern_id = NEW.id
         AND psb.bust_min_in IS NOT NULL
         AND psb.bust_max_in IS NOT NULL
         AND (
           NEW.garment_category = 'top'
           OR (psb.hip_min_in IS NOT NULL AND psb.hip_max_in IS NOT NULL)
         )
    ) INTO v_has_valid_band;

    IF NOT v_has_valid_band THEN
      RAISE EXCEPTION
        'Cannot publish pattern "%" (%): missing valid pattern_size_bands row (bust bounds required; non-null hip bounds required for category %)',
        NEW.slug,
        NEW.id,
        NEW.garment_category;
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM pattern_views pv
       WHERE pv.pattern_id = NEW.id
         AND pv.cover_image_path IS NOT NULL
         AND length(trim(pv.cover_image_path)) > 0
         AND pv.vec_full IS NOT NULL
         AND pv.vec_bodice IS NOT NULL
         AND pv.vec_sleeves IS NOT NULL
    ) INTO v_has_valid_view;

    IF NOT v_has_valid_view THEN
      RAISE EXCEPTION
        'Cannot publish pattern "%" (%): at least one pattern_views row with cover_image_path and regional embeddings is required',
        NEW.slug,
        NEW.id;
    END IF;

    IF NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_patterns_publish_readiness
  BEFORE INSERT OR UPDATE ON patterns
  FOR EACH ROW
  EXECUTE FUNCTION enforce_pattern_publish_readiness();

-- Row-Level Security (Enabled on ALL tables; public read-only policies guarded for Supabase roles)
ALTER TABLE makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_size_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE curated_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_windows ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_role TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format(
        'GRANT SELECT ON makers, patterns, pattern_size_bands, pattern_views, curated_archetypes TO %I',
        v_role
      );

      EXECUTE format(
        'CREATE POLICY %I ON makers FOR SELECT TO %I USING (vetted_status = ''approved'')',
        v_role || '_read_approved_makers',
        v_role
      );

      EXECUTE format(
        'CREATE POLICY %I ON patterns FOR SELECT TO %I USING (status = ''published'' AND EXISTS (SELECT 1 FROM makers m WHERE m.id = patterns.maker_id AND m.vetted_status = ''approved''))',
        v_role || '_read_published_patterns',
        v_role
      );

      EXECUTE format(
        'CREATE POLICY %I ON pattern_size_bands FOR SELECT TO %I USING (EXISTS (SELECT 1 FROM patterns p JOIN makers m ON m.id = p.maker_id WHERE p.id = pattern_size_bands.pattern_id AND p.status = ''published'' AND m.vetted_status = ''approved''))',
        v_role || '_read_published_size_bands',
        v_role
      );

      EXECUTE format(
        'CREATE POLICY %I ON pattern_views FOR SELECT TO %I USING (EXISTS (SELECT 1 FROM patterns p JOIN makers m ON m.id = p.maker_id WHERE p.id = pattern_views.pattern_id AND p.status = ''published'' AND m.vetted_status = ''approved''))',
        v_role || '_read_published_views',
        v_role
      );

      EXECUTE format(
        'CREATE POLICY %I ON curated_archetypes FOR SELECT TO %I USING (active = true)',
        v_role || '_read_active_archetypes',
        v_role
      );
    END IF;
  END LOOP;
END $$;
