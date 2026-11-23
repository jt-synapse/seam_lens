# SeamLens Studio (v1) — Formal Technical Architecture Specification

**Date:** 2026-11-22  
**Product:** SeamLens Studio (v1.0 MVP)  
**Source Basis:** [PRODUCT_STITCH.md](../../../PRODUCT_STITCH.md) (Authoritative v1 PRD) & [PRODUCT_BRIEF.md](../../../PRODUCT_BRIEF.md) (Risk, Evaluation & Economic Context)  
**Status:** Ready for Approval  

---

## 1. Intent & Why

Sewists who spot garment inspiration on Instagram, Pinterest, street style, or vintage archives have no reliable way to find an independent sewing pattern that actually constructs that garment:

1. **General visual search (Google Lens, Pinterest)** optimizes for ready-to-wear retail listings and indexes surface color, fabric print, and styling—returning floral t-shirts for a floral bias-cut midi dress.
2. **Existing sewing pattern platforms (Threadloop, The Fold Line, PatternReview)** rely exclusively on text search and manual faceted filtering, with no automated photo-to-pattern discovery.
3. **Open marketplaces (Etsy)** are saturated with unvetted, AI-hallucinated $2–$5 PDF listings with broken grading and unsewable geometry, eroding sewist trust.

**SeamLens Studio v1** solves this by pairing a **print-blind, construction-aware optical matching engine** with a **100% permissioned, human-vetted catalog of independent patternmakers**, delivered as a mobile-first web outbound aggregator with an editorial, tactile atelier interface.

---

## 2. Goals, Non-Goals, & Anti-Goals

### 2.1 v1 Goals (KPIs & SLAs from PRD)
1. **Construction-First Visual Discovery:** Accept uploaded garment photos, mobile camera captures, direct image URLs, and one-click curated archetypes, matching on seam topography, neckline, darts, sleeve construction, waist, skirt geometry, closures, and drape while suppressing surface print and color.
2. **Instant Part-Focus Isolation:** Let sewists isolate `Full Silhouette` (default), `Bodice & Neckline`, `Sleeves & Armscye`, or `Skirt & Hemline` without re-running slow vision inference on toggle.
3. **Measurement-True Sewability Filtering:** Filter across **Fabric Substrate** (`Woven` vs. `Knit / Stretch`), **Canonical Body Measurements** (Full Bust and Full Hip in inches, `32"–64"+`, normalized across designer size labels), **Delivery Formats** (`PDF A4/Letter`, `Copyshop A0`, `Projector`, `Paper Envelope`), and **Skill Level** (`Confident Beginner`, `Intermediate`, `Advanced / Couture`).
4. **Explainable Results & Outbound Attribution:** Render ranked match cards with an instant **Cover Photo ↔ Technical Flat** toggle, plain-English **Matched** and **Diff / Minor Hack** construction chips, and tracked `/go/[pattern_id]` redirects targeting **>25% outbound CTR** to indie maker storefronts.
5. **Atelier Admin Curation Cockpit:** Provide Steph and Engineering an authenticated web interface to import Shopify/CSV batch drafts, audit/edit AI-extracted `construction_profile` JSON tags and canonical bust/hip inch bounds, and publish/unpublish/takedown catalog items.
6. **Hard Performance & Quality Targets:**
   - **Catalog Density:** 15–25 vetted indie houses, **300–500 active Dress & Top views** at launch.
   - **Optical Accuracy:** **≥85% top-3 match relevance** on standard construction features across a labeled benchmark suite of 50+ real-world inspiration photos.
   - **Search Latency:** **<3.5 seconds (p95)** end-to-end from visual upload submission to ranked result rendering; **<100 ms** for subsequent filter or Part-Focus toggles.

### 2.2 Non-Goals (Deferred to Phase 2+)
- **In-app checkout, payment processing, sales tax/VAT-MOSS, or PDF pattern file hosting** (Phase 3; v1 is strictly an outbound aggregator).
- **Consumer sewist accounts, saved boards/wishlists, stash tracking, or social feeds** (Phase 2; v1 auth is strictly Admin-only for Steph and Engineering — *resolved in favor of PRD §3.2 over the optional light-accounts hypothesis in Product Brief §6*).
- **Automated fabric yardage & haberdashery partner-feed pairing** (Phase 2).
- **Camera/AR body measurement, parametric pattern generation/drafting, or fiber identification from photos** (explicitly excluded per Product Brief §5).
- **Native iOS / Android apps** (Phase 3; v1 is responsive mobile-first web).
- **Standalone public `/patterns/[slug]` detail pages or `/makers/[slug]` profile pages [PRD §3.1.4 / Architect Call]:** All pattern inspection (Cover ↔ Front/Back Technical Flat toggle, Matched/Diff chips, sizing, and specs) lives directly on the ranked result cards so sewists click straight out via `/go/[pattern_id]` without an extra intermediate hop diluting the `>25%` outbound CTR target (`slug` columns exist for deterministic CDN asset paths, admin routes, and Phase-2 forward compatibility).
- **Non-Dress/Top garment categories** (trousers, tailored outerwear, swimwear, menswear, kids, bags deferred beyond v1).

### 2.3 Anti-Goals (Systemic Failure Conditions)
- **Print-driven retrieval:** Returning garments that share a floral print or color palette rather than seam/block construction.
- **Unvetted or scraped supply:** Indexing patterns without maker opt-in/permission or allowing AI-slop listings into live results.
- **Retaining copyrighted user inspiration uploads:** Permanently storing user-uploaded Instagram/Pinterest/retail photos in object buckets, creating IP and privacy liability.
- **Unbounded AI unit costs:** Allowing bot traffic, repeated filter clicks, or viral spikes to trigger runaway Vision LLM spend.

---

## 3. Constraints & Architectural Guardrails

- **Small-Team Operational Simplicity:** Maintained by 1 Developer + 1 Curation Lead (Steph). Minimize distinct runtimes, separate microservices, and infrastructure vendors.
- **Strict Permissioned Supply Gate:** Database and application layers must physically block publishing any pattern whose parent maker is not marked `approved`.
- **Ephemeral User Media:** User-uploaded bytes and URL-fetched inspiration images exist only in request memory during Vision LLM extraction; only derived structural JSON, text embeddings, and a SHA-256 content hash are cached briefly (`30 min` TTL).
- **Editorial Performance & Visual Authority:** Inspired by *Kripalani Tailors* and *Fold Atelier* ([Screenshot 2026-11-20 at 9.33.59 PM.png](../../../Screenshot%202026-11-20%20at%209.33.59%E2%80%AFPM.png))—calm, tactile linen/paper surfaces, generous negative space, zero CLS, and instant cover-to-flat image transitions. **Explicitly disregard `mockups/`:** any pre-existing HTML/CSS/JS prototype files under `mockups/` in the workspace are non-authoritative and must not be used as feature or token specs.

---

## 4. Architectural Approaches Considered & Selected Direction

All candidates operate within the PRD's core stack envelope (**Next.js App Router + TypeScript + Tailwind CSS + PostgreSQL/`pgvector` + Multimodal Vision LLM**):

### Approach 1: Single-Pass Multi-Region Text-Bridge in a TypeScript Modular Monolith *(SELECTED)*
- **Mechanism:** One Next.js TypeScript service + Supabase (PostgreSQL/`pgvector`, Auth, Storage). At ingestion, a Multimodal Vision LLM inspects each view's **technical flat line drawing + styled photos** to produce a strict `construction_profile` JSONB *plus* **4 print-stripped canonical structural descriptions** (`full`, `bodice_neckline`, `sleeves_armscye`, `skirt_hemline`), embedded via a text embedding model into 4 `vector(768)` columns on `pattern_views`. At query time, the browser resizes/strips EXIF client-side (`≤1280px` WebP), **one** Vision LLM call extracts the JSON profile + all 4 regional structural descriptions simultaneously, **one** batched text-embedding call computes all 4 query vectors, and the session is written to an ephemeral Postgres `UNLOGGED` table (`30 min` TTL). Postgres runs hard SQL sewability filters + active-region `pgvector` cosine similarity + weighted JSON taxonomy scoring and computes **Matched** and **Diff / Minor Hack** chips deterministically.
- **Trade-offs:** Delivers **~1.8–2.7s** initial search (well inside `<3.5s`) and **<80 ms / $0 LLM cost** on Part-Focus or Bust/Hip slider changes; guarantees print-blindness because raw photo pixels never enter `pgvector`; keeps one shared Zod taxonomy across ingestion, Admin UI, search, and benchmark CLI. Trade-off: relies on the Vision LLM's schema + canonical structural text capturing garment geometry without direct pixel-contour comparison.

### Approach 2: Split Web App + Dedicated Python CV Segmentation & Sketch-Embedding Service *(Rejected for v1)*
- **Mechanism:** Next.js handles UI/Admin while a separate Python FastAPI GPU worker runs garment detection, semantic clothing segmentation, and edge/line-art conversion embedded into a shared image-vector space with technical flats.
- **Why rejected:** Introduces a second language/deployment stack (Python + GPU containers) whose cold starts or warm-instance floor either breach the `<3.5s` p95 SLA (`3.5–5.0s`) or inflate baseline monthly burn before a 300–500 view catalog justifies it.

### Approach 3: Coarse Hybrid Retrieval + Live Vision-LLM Cross-Reranker *(Deferred Extension Seam)*
- **Mechanism:** Stage 1 fetches top-12 candidates via SQL/`pgvector`; Stage 2 sends the user's photo alongside those 12 candidates' technical flat images into a second Vision LLM prompt to visually score seam correspondence.
- **Why rejected as default (kept as pluggable seam):** Two sequential multimodal calls push latency to `~4.0–6.0s` (violating `<3.5s`) and multiply per-search API cost `3–5x`. However, the search module exposes a clean `CandidateReranker` interface (no-op in v1) so Stage-2 flat reranking can be toggled on for close ties if benchmark testing ever requires it.

---

## 5. System Architecture & Component Specification

*(Note: Items marked **[PRD/User]** reflect explicit requirements from [PRODUCT_STITCH.md](../../../PRODUCT_STITCH.md), [PRODUCT_BRIEF.md](../../../PRODUCT_BRIEF.md), or the user's selection of Approach 1. Items marked **[Architect Call]** are concrete technical decisions settled in this specification.)*

### 5.1 System Topology & Module Boundaries

```text
+-----------------------------------------------------------------------------------+
|                        CLIENT BROWSER (Mobile Safari / Chrome / Desktop)          |
|  - Canvas Preprocessor (EXIF orient/strip, <=1280px WebP ~180KB, optional crop)   |
|  - Upload Dock | Interactive Part-Focus & Sewist Filter Bar | Cover<->Flat Cards  |
+-------------------+-------------------------------+-----------------------+-------+
                    | POST /api/v1/search/analyze   | POST /api/v1/search   | GET /go/[id]
                    | (Multipart WebP or Image URL) | /query (queryId+filt) | (302 Redirect)
                    v                               v                       v
+-----------------------------------------------------------------------------------+
|                NEXT.JS APP ROUTER MODULAR MONOLITH (TypeScript, Node 22)          |
|                                                                                   |
|  [src/modules/taxonomy]   Canonical Zod schemas, regional prose serializer,       |
|                           inch/cm normalizers, deterministic Match/Diff engine    |
|  [src/modules/vision]     VisionExtractor (Gemini 2.5 Flash structured JSON)      |
|                           + TextEmbedder (768-d batched text embeddings)          |
|  [src/modules/search]     SSRF-safe URL fetcher, rate limiter, cost circuit       |
|                           breaker, hybrid SQL+pgvector ranker, CandidateReranker  |
|  [src/modules/catalog]    Public read queries, /go/[id] UTM builder + click log   |
|  [src/modules/ingestion]  Shopify JSON & CSV parsers, WebP media pipeline,        |
|                           chunked idempotent draft-import worker                  |
|  [src/modules/admin]      Atelier Curation Dashboard (Auth-gated RSC + Actions):  |
|                           Draft queue, flat/photo inspector, tag editor, publish  |
+-------------------+-------------------------------+-----------------------+-------+
                    |                               |                       |
                    v                               v                       v
+-----------------------------------+ +-------------------------+ +-----------------+
|   SUPABASE POSTGRESQL 16 +        | | SUPABASE STORAGE + CDN  | | MULTIMODAL AI   |
|   pgvector (Single Data Plane)    | | `catalog-media` bucket  | | API PROVIDERS   |
| - makers, patterns, pattern_views | | - Vetted covers & flats | | - Gemini 2.5    |
| - curated_archetypes              | | - Archetype samples     | |   Flash (Vision)|
| - UNLOGGED query_sessions (30m)   | | (ZERO user uploads      | | - 768-d Text    |
| - ingestion_batches / _items      | |  stored on disk/bucket) | |   Embedding API |
| - search_events, outbound_clicks  | +-------------------------+ +-----------------+
| - api_usage_ledger, rate_limits   |
+-----------------------------------+
```

- **Deployment Target [PRD/Architect Call]:** Next.js 15+ (App Router, TypeScript 5.x, Tailwind CSS v4) running on **Vercel** (Node.js runtime, `maxDuration = 30s` on search routes, `60s` on chunked admin ingestion steps) paired with **Supabase** (PostgreSQL 16 + `pgvector`, Supabase Auth for Admin, Supabase Storage + CDN for permissioned maker media).
- **Why No Separate Redis Vendor [Architect Call]:** Ephemeral query state (`extracted_profile` + 4x `vector(768)`) is stored in a **PostgreSQL `UNLOGGED` table (`query_sessions`)** with a `30-minute` TTL. `UNLOGGED` tables bypass WAL write overhead (~1–2 ms inserts/lookups) and allow the hybrid search query to `JOIN query_sessions` directly inside Postgres—eliminating extra vendor ops and avoiding serializing `3,072` floats over HTTP on every filter slider adjustment.

---

### 5.2 Canonical Garment Construction Taxonomy (`ConstructionProfile` v1)

**[PRD/Architect Call]** Shared via `src/modules/taxonomy/construction-profile.ts` (Zod schema) across Vision LLM structured output, Postgres `JSONB` validation, Admin tag editing, and the Benchmark CLI. Scoped specifically to **Dresses & Tops** for v1:

```typescript
export type GarmentCategory = 'dress' | 'top';
export type SubstrateCompatibility = 'woven' | 'knit' | 'both';

export interface ConstructionProfileV1 {
  schema_version: 1;
  garment_category: GarmentCategory;
  substrate_compatibility: SubstrateCompatibility;

  silhouette: {
    overall_shape:
      | 'a_line' | 'fit_and_flare' | 'empire' | 'shift_column'
      | 'sheath_fitted' | 'tiered_smock' | 'wrap' | 'shirt_dress_blouse'
      | 'bias_slip' | 'peplum' | 'boxy_cropped' | 'trapeze_tent';
    ease_level: 'negative_ease' | 'close_fitting' | 'semi_fitted' | 'relaxed' | 'oversized';
    garment_length: 'cropped' | 'hip_length' | 'tunic' | 'mini' | 'knee' | 'midi' | 'maxi';
  };

  bodice_and_neckline: {
    neckline_type:
      | 'crew_round' | 'scoop' | 'v_neck' | 'surplice_wrap' | 'square'
      | 'sweetheart' | 'boat_bateau' | 'cowl' | 'halter' | 'collared_shirt'
      | 'mandarin_band' | 'tie_neck_bow' | 'off_shoulder' | 'one_shoulder'
      | 'high_mock_turtleneck' | 'keyhole';
    neckline_depth: 'high' | 'modest_mid' | 'deep_plunging';
    collar_type: 'none' | 'classic_point' | 'peter_pan' | 'camp_revere' | 'band_stand' | 'shawl' | 'ruffle_frill';
    shaping_darts_seams: Array<
      | 'bust_dart' | 'waist_dart' | 'french_dart' | 'princess_seam_shoulder'
      | 'princess_seam_armscye' | 'shirring_elastic' | 'gathers_yoke'
      | 'tucks_pleats' | 'boning_corsetry' | 'bias_drape' | 'none_cut_straight'
    >;
    waist_definition:
      | 'natural_seam' | 'empire_seam' | 'dropped_waist_seam'
      | 'no_waist_seam_continuous' | 'cinched_tie_belt' | 'elasticated_waist';
    back_detail: 'closed_solid' | 'low_open_back' | 'cutout' | 'tie_back' | 'shirred_back_panel' | 'unknown';
  };

  sleeves_and_armscye: {
    armscye_construction:
      | 'set_in' | 'dropped_shoulder' | 'raglan'
      | 'dolman_grown_on' | 'yoke_sleeve' | 'sleeveless_straps' | 'sleeveless_cut_in';
    sleeve_style:
      | 'none_sleeveless' | 'spaghetti_camisole' | 'wide_strap' | 'cap'
      | 'fitted_straight' | 'puff_gathered_cap' | 'puff_gathered_hem'
      | 'puff_full_lantern' | 'bishop' | 'flutter_bell' | 'fluted_flare' | 'kimono_wide';
    sleeve_length: 'sleeveless' | 'cap' | 'short' | 'elbow' | 'three_quarter' | 'wrist_long';
    cuff_finish: 'none_hemmed' | 'elastic_casing' | 'buttoned_placket_cuff' | 'band_cuff' | 'tie_cuff' | 'bias_bound';
  };

  skirt_and_hemline: {
    has_skirt_section: boolean; // true for dresses/peplum; false for standard tops
    skirt_construction:
      | 'none_top_hem' | 'gathered_rectangle' | 'tiered_gathered' | 'a_line_panel'
      | 'gored_panels' | 'circle_half_full' | 'bias_cut' | 'wrap_overlap'
      | 'pleated_box_knife' | 'pencil_straight' | 'tulip_draped';
    tier_count: 0 | 1 | 2 | 3; // 3 represents 3+ tiers
    slit_detail: 'none' | 'side_slit' | 'front_slit' | 'back_vent' | 'wrap_opening';
    hemline_shape: 'straight_level' | 'curved_shirt_tail' | 'high_low' | 'asymmetric' | 'ruffle_flounce';
    pockets: Array<'none_visible' | 'in_seam' | 'patch' | 'slash_welt'>;
  };

  closures_and_details: {
    primary_closure:
      | 'pullover_no_closure' | 'invisible_zip_back' | 'invisible_zip_side'
      | 'exposed_zip' | 'button_front_full' | 'button_front_partial_placket'
      | 'button_back' | 'wrap_tie' | 'hook_keyhole' | 'shirred_stretch';
    finish_structure: 'unlined_faced' | 'lined_bodice' | 'fully_lined' | 'bias_bound' | 'unknown';
  };

  /** Print-free structural geometry notes per region (max ~35 words each; color/print words banned) */
  structural_nuance_notes: {
    bodice_neckline: string;
    sleeves_armscye: string;
    skirt_hemline: string;
    overall_drape_and_proportions: string;
  };
}
```

#### Print-Blind Regional Text Serialization (`serializeCanonicalRegions`)
**[Architect Call]** Rather than embedding raw LLM free text directly, `serializeCanonicalRegions(profile)` deterministically combines normalized enum labels with sanitized `structural_nuance_notes` (stripping a denylist of color/print/styling tokens such as *floral, gingham, plaid, polka, red, blue, denim wash, leather*) into 4 canonical strings:
1. `full_silhouette`: Full construction summary across silhouette, substrate, bodice/neckline, sleeves/armscye, skirt/hemline, closure, and drape proportions.
2. `bodice_neckline`: Neckline type/depth, collar, bust/waist darting & princess seams, shirring, waist seam, bodice ease, and substrate.
3. `sleeves_armscye`: Armscye cut, sleeve silhouette, volume/gather placement, length, cuff finish, and substrate.
4. `skirt_hemline`: Skirt panel/gather/circle/bias geometry, tier count, waist join, length, slit, pockets, hemline shape, and substrate.

**Critical Curation Sync Rule:** Whenever Steph edits any tag in `construction_profile` inside the Atelier Admin Dashboard and clicks Save, the server action automatically runs `serializeCanonicalRegions(updatedProfile)` and regenerates all 4 embeddings (`vec_full`, `vec_bodice`, `vec_sleeves`, `vec_skirt`) within the same save flow (~200 ms), guaranteeing `pgvector` never drifts from human curation.

---

### 5.3 Database Physical Schema, Indexing & Security (PostgreSQL + `pgvector`)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Vetted Indie Pattern Houses
CREATE TABLE makers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  storefront_url TEXT NOT NULL,
  platform_type TEXT NOT NULL CHECK (platform_type IN ('shopify', 'woocommerce', 'custom')),
  vetted_status TEXT NOT NULL DEFAULT 'pending' CHECK (vetted_status IN ('pending', 'approved', 'suspended')),
  permission_evidence_note TEXT, -- Records opt-in email/agreement date
  utm_campaign_slug TEXT NOT NULL DEFAULT 'seamlens_v1',
  affiliate_query_param TEXT,    -- Optional e.g. 'ref=seamlens'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Canonical Patterns (Design-Level Garment Entity)
CREATE TABLE patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maker_id UUID NOT NULL REFERENCES makers(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE,      -- Used for storage paths (`catalog-media/{maker_slug}/{pattern_slug}`) & Admin URLs
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

-- 2b. Pattern Size Bands / Commercial Offerings (1:N per Pattern) [Architect Call]
-- Unifies indie makers who sell Straight (e.g. 0-20) and Curve/Plus (e.g. 14-34) as separate
-- Shopify products under a single canonical pattern so Top-3 results never duplicate identical flats.
CREATE TABLE pattern_size_bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id UUID NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
  maker_id UUID NOT NULL REFERENCES makers(id) ON DELETE CASCADE,
  external_product_id TEXT,       -- Nullable for manual CSV; idempotent key for Shopify re-imports
  band_label TEXT NOT NULL DEFAULT 'Standard', -- e.g. 'Standard', 'Straight (0–20)', 'Curve (14–34)'
  is_default BOOLEAN NOT NULL DEFAULT true,
  product_url TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  designer_size_label TEXT,       -- e.g. 'US 0–20 (B/C Cup)' or 'US 14–34 (C–H Cup)'
  -- Canonical Measurement-True Bounds (Inches) [PRD §2 & §3.1.3]
  -- Hip bounds are required for dresses/sets, nullable for cropped/bust-only tops.
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
  view_code TEXT NOT NULL,        -- e.g. 'view_a_midi'
  view_label TEXT NOT NULL,       -- e.g. 'View A — Square-Neck Puff Midi'
  garment_category TEXT NOT NULL CHECK (garment_category IN ('dress', 'top')),
  is_primary_view BOOLEAN NOT NULL DEFAULT false,
  cover_image_path TEXT NOT NULL, -- Supabase Storage path
  flat_front_image_path TEXT,     -- Strongly preferred; nullable if maker lacks flat
  flat_back_image_path TEXT,
  construction_profile JSONB NOT NULL,
  canonical_texts JSONB NOT NULL, -- { full, bodice_neckline, sleeves_armscye, skirt_hemline }
  vec_full     vector(768) NOT NULL,
  vec_bodice  vector(768) NOT NULL,
  vec_sleeves vector(768) NOT NULL,
  vec_skirt   vector(768),        -- NULL when has_skirt_section = false
  ai_confidence NUMERIC(3,2) CHECK (ai_confidence BETWEEN 0.00 AND 1.00),
  human_verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pattern_id, view_code)
);

-- 4. One-Click Curated Upload Dock Archetypes (Zero-LLM-Cost Instant Search)
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
  crop_box JSONB,                 -- Nullable { x, y, w, h } normalized 0..1
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

-- 7. Search Telemetry, Outbound Click Attribution & Cost Guardrails
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
  user_id UUID PRIMARY KEY, -- Matches auth.users.id in Supabase Auth
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('curator', 'engineer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Index Strategy & Publish Guardrails **[Architect Call]**
- **Vector Indexes:** HNSW (`vector_cosine_ops`, `m = 16`, `ef_construction = 64`) on `pattern_views(vec_full)`, `vec_bodice`, `vec_sleeves`, and partial HNSW on `vec_skirt WHERE vec_skirt IS NOT NULL`. Search queries execute with `SET LOCAL hnsw.iterative_scan = relaxed_order` so strict SQL `WHERE` filters never truncate candidate recall.
- **Relational Indexes:** Composite B-tree on `patterns(status, substrate_type, skill_level)`, `GIN(patterns.formats)`, `pattern_size_bands(pattern_id, bust_min_in, bust_max_in, hip_min_in, hip_max_in)`, and `query_sessions(image_sha256, expires_at)`.
- **Database-Enforced Publish Trigger:** A `BEFORE INSERT OR UPDATE ON patterns` trigger blocks setting `status = 'published'` unless:
  1. Parent `makers.vetted_status = 'approved'`,
  2. At least one child `pattern_size_bands` row exists with non-null `bust_min_in` and `bust_max_in`—and if `patterns.garment_category IN ('dress', 'dress_and_top_set')`, non-null `hip_min_in` and `hip_max_in` (`hip_*` may be `NULL` on cropped/chest-only `'top'` patterns whose maker charts omit hip), and
  3. At least one child `pattern_views` row exists with non-null `cover_image_path`, `vec_full`, `vec_bodice`, and `vec_sleeves`.
- **Row-Level Security (RLS):** Enabled on all tables. Public anonymous role has `SELECT` only on `makers (vetted_status = 'approved')`, `patterns (status = 'published')`, `pattern_size_bands` and `pattern_views` belonging to published patterns, and `curated_archetypes (active = true)`. All writes, `query_sessions`, telemetry, and draft views run through server-only service/admin credentials verified against `admin_users`.

---

### 5.4 Vision Extraction, Hybrid Ranking & Explainability Pipeline

#### 1. Model & Embedding Selection **[Architect Call]**
- **Vision Extractor:** `gemini-2.5-flash` via `@google/genai` SDK using strict `responseSchema` (derived directly from `ConstructionProfileV1`) with `thinkingConfig: { thinkingBudget: 0 }` on live user queries for sub-2s deterministic latency, and `thinkingBudget: 1024` on offline catalog ingestion where deeper flat-drawing inspection improves tag accuracy without latency pressure.
- **Text Embedder:** `gemini-embedding-001` (or `text-embedding-004`) configured at `outputDimensionality: 768` with L2 normalization (`RETRIEVAL_QUERY` vs `RETRIEVAL_DOCUMENT` task types), batch-embedding all 4 regional strings in a single HTTP request (`~120–200 ms`).
- **Provider Abstraction:** Wrapped behind `VisionExtractor` and `TextEmbedder` TypeScript interfaces in `src/modules/vision/` so swapping to an OpenAI (`gpt-4.1-mini` + `text-embedding-3-small`) or Vertex endpoint requires zero changes to search or ingestion business logic.

#### 2. End-to-End Query Flow & `<3.5s` Latency Budget

| Step | Component | Operation | p50 | p95 |
| :--- | :--- | :--- | :---: | :---: |
| 1 | Browser `<canvas>` | EXIF orient + strip metadata + resize `≤1280px` WebP (`q=0.82`, ~160 KB) + optional user crop | 90 ms | 180 ms |
| 2 | `POST /api/v1/search/analyze` | Rate-limit check + daily budget gate + SHA-256 cache lookup in `query_sessions` | 40 ms | 110 ms |
| 3 | `VisionExtractor` | Single multimodal structured JSON call (extracts `ConstructionProfileV1` + 4 regional nuances + edge-case flags) | 1,350 ms | 2,050 ms |
| 4 | `TextEmbedder` | Single batched call embedding `[full, bodice_neckline, sleeves_armscye, skirt_hemline]` | 130 ms | 230 ms |
| 5 | Postgres + `pgvector` | `INSERT INTO query_sessions` + Hybrid SQL/vector rank + view dedup + deterministic chips | 18 ms | 40 ms |
| 6 | Next.js → Browser | Stream JSON payload + render cards (CDN WebP thumbnails) | 90 ms | 160 ms |
| **Total** | **Cold Upload Search** | **End-to-End Visual Query to Rendered Cards** | **~1.72 s** | **~2.77 s** |
| **Refinement** | `POST /api/v1/search/query` | **Part-Focus switch or Sewist Filter change (`querySessionId` lookup, 0 LLM calls)** | **~35 ms** | **~80 ms** |

*Note:* If `query_sessions` suffers an unlogged-table eviction (e.g., rare Postgres failover within a user's 30-minute session), the client keeps the resized `160 KB` blob in browser memory and transparently re-analyzes once if `/api/v1/search/query` returns `404 SESSION_EXPIRED`.

#### 3. Hybrid Ranking Formula & Part-Focus Semantics **[Architect Call]**

**Step A — Hard SQL Sewability Predicate:**
- `p.status = 'published'` AND `m.vetted_status = 'approved'`
- **Region-Aware Category Gate:**
  - `full_silhouette`: `pv.garment_category = q.garment_category` (unless Vision flags a cropped/ambiguous lower frame, in which case both `'dress'` and `'top'` are searched).
  - `bodice_neckline` or `sleeves_armscye`: Searches **both `'dress'` and `'top'`** views—because a sewist isolating a square bodice or bishop sleeve from a dress photo can construct it from either a dress pattern or a blouse pattern (and cards clearly badge `Top Block` vs `Dress`).
  - `skirt_hemline`: Requires `pv.vec_skirt IS NOT NULL` (`has_skirt_section = true`).
- **Fabric Substrate Filter (when selected):** `'woven'` → `p.substrate_type IN ('woven', 'both')`; `'knit'` → `p.substrate_type IN ('knit', 'both')`.
- **Canonical Measurement Filter (Point Body-Measurement Inclusion) [Architect Call]:** User sets single-value **My Full Bust (`:user_bust_in`, `32"–64"+`)** and/or **My Full Hip (`:user_hip_in`, `32"–68"+`)** sliders/inputs (defaulting to `null` / unfiltered). Rather than dual-thumb span containment (which would falsely exclude Plus-only or Straight-only makers at slider extremes), a pattern matches iff **at least one** `pattern_size_bands` row covers both measurements simultaneously:
  ```sql
  EXISTS (
    SELECT 1 FROM pattern_size_bands psb
    WHERE psb.pattern_id = p.id
      AND (:user_bust_in IS NULL OR (psb.bust_min_in <= :user_bust_in AND psb.bust_max_in >= :user_bust_in))
      AND (
        :user_hip_in IS NULL
        OR (psb.hip_min_in IS NULL AND p.garment_category = 'top')
        OR (psb.hip_min_in <= :user_hip_in AND psb.hip_max_in >= :user_hip_in)
      )
  )
  ```
- **Delivery Format & Skill Level:** Within a facet, multi-select uses **OR** (`p.formats && :formats`, `p.skill_level = ANY(:skills)`); across facets, predicates combine via **AND**.

**Step B — Hybrid Construction Score ($S_{\text{total}} \in [0, 1]$):**
For query $q$, candidate view $v$, and active focus region $r \in \{\text{full}, \text{bodice}, \text{sleeves}, \text{skirt}\}$:

$$S_{\text{total}}(q, v \mid r) = 0.55 \cdot S_{\text{vec}}(q, v \mid r) + 0.45 \cdot S_{\text{struct}}(q, v \mid r)$$

- $S_{\text{vec}}(q, v \mid r) = \max\left(0,\; 1 - (v.\text{vec}_r \Leftrightarrow q.\text{vec}_r)\right)$ (cosine similarity on region $r$'s print-blind text vector).
- $S_{\text{struct}}(q, v \mid r)$: Deterministic weighted field-match score computed in SQL/TypeScript over `construction_profile`:
  - **`full_silhouette` weights:** `overall_shape` (`0.20`), `bodice_and_neckline` sub-score (`0.30`: neckline type `0.14`, darts/seams Jaccard `0.10`, waist definition `0.06`), `sleeves_and_armscye` sub-score (`0.20`: style `0.10`, armscye `0.05`, length `0.05`), `skirt_and_hemline` sub-score (`0.20` for dresses—construction `0.12`, tiers `0.04`, length `0.04`; redistributed proportionally to silhouette/bodice/sleeves when $q$ is a `top`), `substrate_compatibility + primary_closure` (`0.10`).
  - **`bodice_neckline` weights:** `bodice_and_neckline` sub-score (`0.85`: neckline type `0.35`, neckline depth & collar `0.15`, darts/seams Jaccard `0.20`, waist definition `0.15`) + `substrate_compatibility & ease_level` (`0.15`).
  - **`sleeves_armscye` weights:** `sleeves_and_armscye` sub-score (`0.85`: sleeve style `0.35`, armscye construction `0.20`, sleeve length `0.18`, cuff finish `0.12`) + `substrate_compatibility` (`0.15`).
  - **`skirt_hemline` weights:** `skirt_and_hemline` sub-score (`0.85`: skirt construction `0.35`, tier count `0.15`, garment length `0.15`, slit & hemline shape `0.12`, pockets `0.08`) + `substrate_compatibility & waist_definition` (`0.15`).
- **Per-Pattern View Grouping:** Ranks at the `pattern_views` grain (fetching top 40 views), then collapses by `pattern_id` keeping the highest-scoring view per pattern as the displayed card (with a subtle indicator if secondary views exist) and returns the top 18 patterns.
- **Zero-Match Relaxation Hint:** When hard filters return 0 patterns, a lightweight count query checks single-facet relaxations and returns structured relaxation hints (e.g., *"0 matches with Projector file — 5 matches available in Copyshop A0"*).

**Step C — Deterministic Match & "Minor Hack / Diff" Chips [PRD §3.1.4 + Brief §9]:**
Computed in `<1 ms` by comparing $q.\text{extracted\_profile}$ against $v.\text{construction\_profile}$ on the active region's slots:
- **Matched Chips (up to 4):** Emitted for exact/compatible matches in priority order (e.g., `Matched: Mid Square Neckline`, `Bust + Waist Darts`, `Elbow Puff Sleeve`, `Gathered Midi Skirt`).
- **Diff / Minor Hack Chips (up to 2):** Emitted when a top-ranked pattern ($S_{\text{total}} \ge 0.62$) differs on a primary structural slot (e.g., `Diff: Sleeveless block (add sleeve)` or `Diff: Scoop neckline vs. Square` or `Note: Drafted for Knit`).

#### 4. Input Security & Edge-Case Handling **[Architect Call]**
- **SSRF-Hardened Direct Image URL Fetch:** Allows `https:` only; resolves DNS prior to socket connection and blocks private/loopback/link-local/metadata CIDRs (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`); enforces `3s` timeout, max `1` validated redirect, `8 MB` byte stream cap, and magic-byte image verification (`JPEG`, `PNG`, `WebP`, `AVIF`). If the URL returns `text/html` (e.g., a pasted Instagram or Pinterest post link), returns a clear `422 HTML_PAGE_URL_UNSUPPORTED` message prompting the sewist to drop a quick screenshot instead.
- **Non-Garment / Out-of-Scope / Multi-Garment Inputs:**
  - *No garment visible:* Returns `422 NO_GARMENT_DETECTED` without writing a session.
  - *Trousers / menswear / outerwear uploaded:* Sets `query_status = 'unsupported_category_v1'`, displays a clear banner that SeamLens Studio v1 indexes **Dresses & Tops**, and if an upper-body garment is present (e.g., jacket/jumpsuit), offers one-tap `Bodice & Neckline` or `Sleeves` part-focus matching.
  - *Multiple people in frame:* Vision prompt targets the foreground center-most Dress/Top and flags `warnings: ['multiple_garments_detected']`, prompting an optional client crop box to re-focus on another figure.

---

### 5.5 Batch Catalog Ingestion & Atelier Admin Curation Workflow

#### 1. Batch Ingestion Pipeline (`src/modules/ingestion/`)
**[PRD §3.1.5 / Architect Call]** Supports two permissioned input formats:
1. **Shopify Storefront JSON (`products.json`):** Admin selects an `approved` maker and pastes their shop URL or collection/product handle filter.
2. **Canonical SeamLens CSV Upload:** Standardized CSV columns (`external_id, title, band_label, product_url, price, currency, garment_category, substrate_type, bust_min_in, bust_max_in, hip_min_in, hip_max_in, designer_size_label, formats, skill_level, view_code, view_label, cover_image_url, flat_front_image_url, flat_back_image_url, description_html`).

**Chunked Execution (Serverless-Safe):**
- Submitting an import creates an `ingestion_batches` record + `N` `ingestion_items` rows (`stage = 'queued'`).
- The Admin UI (or background cron trigger) drives `POST /api/admin/ingestion/process-chunk` in concurrency-bounded batches of `3` items per invocation (`<30s` per chunk, idempotent on retry):
  1. **Media Sync, Size-Band Grouping & Classification:** For Shopify JSON imports, sibling listings that represent Straight vs. Curve/Plus editions of the same design (matched via normalized base title + Admin merge/link control) attach as separate `pattern_size_bands` rows under one parent `patterns` record rather than duplicating `pattern_views`. Vision LLM classifies gallery images into `cover`, `flat_front`, `flat_back`, or `ignore`, and splits multi-view patterns (`View A`, `View B`) when distinct garment views are described. Approved cover & flat images are converted via `sharp` to `800px` and `1600px` WebP in Supabase Storage `catalog-media`.
  2. **Technical-Flat-First Extraction:** Vision LLM inspects **technical flat line drawings as primary geometric ground truth** (using styled photos only for drape/proportion cues and product HTML for substrate, yardage/format, and size chart numbers, converting `cm → inches` automatically when needed).
  3. **Draft Persistence:** Writes `patterns (status = 'draft')` and `pattern_views (human_verified = false)` with all 4 regional embeddings pre-computed. Items with missing bust/hip bounds or `ai_confidence < 0.80` are flagged in the review queue.

#### 2. Atelier Admin Curation Dashboard (`/admin`)
- **Authentication:** Supabase Auth (`email + password` or magic link) checked in Next.js middleware + Server Actions against the `admin_users` allowlist table (`curator` = Steph, `engineer` = Developer). Zero public sign-up route.
- **Core Screens:**
  1. **Makers Directory (`/admin/makers`):** Add/edit indie makers, record opt-in permission notes, configure UTM/affiliate params, set `approved` / `suspended` status (suspending a maker immediately hides all their patterns from live search).
  2. **Batch Import Runner (`/admin/imports`):** Trigger CSV or Shopify imports with live progress bar (`completed / total / failed`) and per-item retry.
  3. **Curation Queue & Pattern Split-View Editor (`/admin/patterns/[id]`):**
     - *Left Pane:* High-contrast zoomable Technical Flat viewer + Styled Cover photo + collapsible raw Shopify/CSV description & size chart reference.
     - *Right Pane:* Structured tag selectors for every `ConstructionProfileV1` field, size-band editor (`Standard` or `Straight` + `Curve` rows with per-band URL, price, and canonical Bust/Hip inch bounds `32"–64"+`), Format checkboxes, Skill selector, and single-click **Save & Re-Embed** + **Publish / Unpublish / Takedown** buttons.
  4. **KPI & Spend Telemetry (`/admin/telemetry`):** Displays 7d/30d search volume, p50/p95 search latency, **Outbound CTR (`outbound_clicks / searches`)**, per-maker outbound click counts (for maker pilot reports!), and daily AI spend against the budget cap.

---

### 5.6 Frontend Surface & Outbound Attribution

Grounded strictly in [PRODUCT_STITCH.md](../../../PRODUCT_STITCH.md) (*Tactile Atelier Aesthetic*—natural linen backdrop, warm pattern-paper surfaces, restrained editorial typography, generous negative space):

1. **Upload Dock & Curated Archetypes (`/`):**
   - Unified upload surface supporting drag-and-drop, mobile camera/photo roll (`<input type="file" accept="image/*">`), direct image URL paste, and **4–6 one-click Curated Archetypes** (served instantly from `curated_archetypes` with zero LLM latency).
   - Optional pre-search Part-Focus pill + crop handle before submitting.
2. **Interactive Discovery Workspace (`/search?q=[querySessionId]`):**
   - **Reference Rail / Top Drawer (Mobile):** Shows user's ephemeral client-side preview (held in browser `URL.createObjectURL` / `sessionStorage` data URL—never fetched back from a server bucket!), detected construction cue summary, and interactive **Part-Focus** selector (`Full Silhouette`, `Bodice & Neckline`, `Sleeves & Armscye`, `Skirt & Hemline`).
   - **Sewist Parametric Filter Bar:** `Woven / Knit` toggle, single-value **My Full Bust (`32"–64"+`)** and **My Full Hip (`32"–68"+`)** inch sliders with numeric readout + `Any` reset, `Format` pills (`PDF A4/Letter`, `Copyshop A0`, `Projector`, `Paper`), and `Skill Level` pills. Every adjustment calls `/api/v1/search/query` (`<80 ms`).
   - **Ranked Match Grid:** Cards display Maker Name + Verified Atelier badge, Pattern Title & View Label, Price, **Cover Photo ↔ Technical Flat** instant toggle right on the card (showing Front flat with an inline `Front / Back` switch when `flat_back_image_path` is present, and hiding the Flat toggle cleanly when `flat_front_image_path IS NULL`), union canonical inch range + designer band labels (`Bust 32"–62" · Hip 34"–64" (Straight & Curve)`), **Matched** chips, **Diff / Minor Hack** chips, and primary outbound CTA button (`View Pattern at [Maker] ↗`) pointing directly to `/go/[pattern_id]` (no intermediate pattern detail page).
3. **Tracked Outbound Redirect (`GET /go/[pattern_id]`):**
   - Validates `patterns.status = 'published'` and `makers.vetted_status = 'approved'`.
   - Resolves the target `pattern_size_bands` row via optional `?band=[sizeBandId]` (automatically selected by the search ranker to match the sewist's active Bust/Hip filter when a maker splits Straight vs. Curve URLs, falling back to `is_default = true`).
   - Builds destination URL with maker's UTM tags (`utm_source=seamlens&utm_medium=visual_search&utm_campaign=...`) + optional `affiliate_query_param`.
   - Schedules non-blocking `INSERT INTO outbound_clicks` via Next.js `after()` and returns an immediate `302 Found` redirect (`<20 ms`).

---

### 5.7 Rate Limiting, Cost Economics & Benchmark Evaluation Harness

#### 1. Abuse Protection & Spend Circuit Breakers **[Brief §9 / Architect Call]**
- **Per-IP Rate Limiting (Postgres atomic token/window table or Vercel Firewall):**
  - `POST /api/v1/search/analyze` (Vision LLM): **10 req / min** and **40 req / hour** per hashed client IP.
  - `POST /api/v1/search/query` (Postgres-only filter/focus): **120 req / min** per IP.
- **Daily Spend Circuit Breaker (`api_usage_ledger`):**
  - Default configurable ceiling: **`$10.00 / day` UTC** (`DAILY_AI_BUDGET_USD` env var).
  - Unit cost with `gemini-2.5-flash` + batch embedding is **~$0.001–$0.002 per cold upload search** (~5,000–10,000 searches per $10) and **<$2.00 total** to ingest all 500 v1 catalog views. If daily spend hits `100%` of ceiling, live image analysis pauses gracefully while curated archetypes and active sessions continue uninterrupted.

#### 2. Offline Benchmark Evaluation Harness & Seed Fixtures (`scripts/eval/`) **[PRD §6.2, Brief §6 / Architect Call]**
To decouple software implementation from external maker contract timelines while preserving the strict ban on unpermissioned scraping, data and evaluation operate in two stages:
- **Stage A — Build-Time Synthetic Seed & Smoke Suite (Shipped in Repo):**
  - `supabase/seed/` includes **20–24 original, IP-clean synthetic Dress & Top test pattern views** (with vector SVG/WebP technical flats, Straight + Curve multi-band examples, cropped-top nullable-hip cases, and bold floral/plaid print-trap decoys) plus **4–6 original Curated Archetype assets** so local development, UI verification, Admin curation, and automated E2E tests work out-of-the-box on Day 1.
  - `eval/fixtures/smoke-v1/` provides a 15-query deterministic smoke benchmark runnable in CI/dev via `pnpm eval:benchmark --smoke` to verify pipeline correctness, `0%` print-trap bleed, and `<3.5s` latency.
- **Stage B — Pre-Launch Production Benchmark (`eval/benchmark-v1/`):**
  - Populated as Steph imports the first 15–25 permissioned maker catalogs via `/admin/imports` and curates 50–100 real inspiration test queries mapped to human-judged ground truth (`relevant_pattern_ids` graded `2` = direct construction match, `1` = single minor hack; `part_focus_cases`; `print_trap_negatives`).
- **CLI Runner (`pnpm eval:benchmark`):** Executes the exact production `VisionExtractor` → `TextEmbedder` → `HybridRanker` pipeline and outputs a markdown/JSON scorecard gating public v1 launch:
  - **Top-3 Relevance Rate** (Release Gate: **`≥ 85%`** per PRD §6.2)
  - **Print-Trap Contamination@3** (Release Gate: **`0%`**)
  - **MRR & NDCG@5** (overall and per Part-Focus region)
  - **Latency p50 / p95** (Release Gate: **`p95 < 3,500 ms`**)

---

## 6. What's Left to the Builder

During implementation planning and coding, the builder has full discretion over:
- Exact directory layout inside `src/` (provided module boundaries in §5.1 are preserved) and choice of UI primitives (e.g., Radix UI / headless primitives + Tailwind CSS tokens implementing the tactile linen/paper aesthetic).
- Exact Vision LLM system prompt wording and few-shot examples, tuned empirically against `eval/benchmark-v1` to maximize the ≥85% top-3 score.
- Tuning the hybrid weight $\alpha$ (starting at `0.55`) and regional field sub-weights once the initial pilot catalog and 50-photo benchmark set are loaded.
- Exact image compression thresholds (`sharp` / browser `<canvas>` quality steps) and scheduled cleanup mechanism for expired `query_sessions` rows (e.g., `pg_cron` every 10 minutes or probabilistic cleanup inside `/api/v1/search/analyze`).
- Visual styling details of the internal `/admin` dashboard (prioritizing clarity and curation speed for Steph over consumer marketing polish).
