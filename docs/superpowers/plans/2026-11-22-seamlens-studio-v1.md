# SeamLens Studio (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build SeamLens Studio v1—a construction-aware visual sewing pattern discovery web aggregator, permissioned batch ingestion pipeline, Atelier Admin curation cockpit, and benchmark evaluation harness.

**Architecture:** Single TypeScript Next.js 15 App Router modular monolith backed by PostgreSQL 16 + `pgvector` (Supabase) and Supabase Storage. Uploads and URL images are processed ephemerally in memory into a strict `ConstructionProfileV1` JSON object plus up to four print-stripped regional text embeddings (`768-d`), cached in an `UNLOGGED` Postgres session table (`30 min` TTL) so Part-Focus and sewability filter refinements execute in `<80 ms` with zero extra LLM calls.

**Tech Stack:** Next.js 15 (App Router, Node.js 22 runtime), TypeScript 5.x, Tailwind CSS v4, PostgreSQL 16 + `pgvector` (`pg` in prod, `@electric-sql/pglite` + `vector` extension in automated tests), Supabase Auth & Storage (`@supabase/supabase-js`, `@supabase/ssr`), `@google/genai` (Gemini structured vision + `gemini-embedding-001`), `zod`, `sharp`, `vitest`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-22-seamlens-technical-architecture-design.md`

## Global Constraints

- **Authoritative Visual Basis:** Derive UI tokens and layouts strictly from `PRODUCT_STITCH.md`, *Fold Atelier* (`Screenshot 2026-11-20 at 9.33.59 PM.png`), and *Kripalani Tailors*. **Explicitly disregard `mockups/`**—do not import, copy, or reference any files under `mockups/`.
- **v1 Garment & Route Scope:** Dress and Top views only (`'dress' | 'top'`). Public routes are `/`, `/search`, and `GET /go/[pattern_id]`—do **not** build standalone `/patterns/[slug]` or `/makers/[slug]` pages, consumer user accounts, saved boards/wishlists, or checkout/PDF hosting.
- **Zero Persisted User Uploads:** Raw bytes from user file uploads or direct image URL pastes must never be written to disk, database columns, or Supabase Storage; persist only `image_sha256`, `ConstructionProfileV1` JSONB, canonical strings, and `vector(768)` columns in `UNLOGGED TABLE query_sessions` (`30 min` TTL).
- **Strict Permissioned Supply Gate:** Database triggers and ingestion workers must physically block importing or publishing patterns unless parent `makers.vetted_status = 'approved'`.
- **Curation Vector Sync:** Every Admin edit to `pattern_views.construction_profile` must synchronously re-run `serializeCanonicalRegions` and `TextEmbedder.embedRegions` before committing so `pgvector` columns never drift from human-curated tags.
- **Hard Performance & Cost Ceilings:** Cold visual search target `<3.5s` p95 (low-latency live extraction and higher-effort catalog extraction per Task 4); filter/Part-Focus query target `<100 ms`; IP rate limits `10 req/min` and `40 req/hr` on `/api/v1/search/analyze`, `120 req/min` on `/api/v1/search/query`; configurable daily spend circuit breaker defaulting to `$10.00/day` UTC (`DAILY_AI_BUDGET_USD`).

## Implementation checklist

Nine of ten implementation tasks are complete on `feat/seamlens-v1`. Task 10 is next.

- [x] **1. Taxonomy and measurements** — Garment schema, canonical serializer and measurement parser (`2251d96`).
- [x] **2. Scoring and explanations** — Regional scoring and match/difference chips (`792396a`).
- [x] **3. Database and sample catalog** — Migrations, publication guards and 68 local WebP fixtures (`9a39429`, `357bc6c`).
- [x] **4. Vision, embeddings and spend limits** — Budgeted model adapters and PostgreSQL contention checks (`db42e6b`). Live model acceptance remains open below.
- [x] **5. Search engine** — Image normalization, rate limits, cached analysis and indexed hybrid ranking (`0a105e9`, `3bde4dd`).
- [x] **6. Public search API** — Browser image preparation, analyze/refine routes and tracked maker redirects (`7e4a180`, `29c05ab`). Pass the prepared blob to `buildPreparedUploadForm` to preserve crop origin.
- [x] **7. Catalog ingestion** — Approved Shopify and CSV imports, immutable media and reviewable drafts (`cd3ea3d`). Migration 004 provisions the default Supabase bucket.
- [x] **8. Public discovery frontend** — Upload, direct image URL and sample entry points at `/`, with part-focus, filters, technical flats and tracked maker links at `/search` (`4ac1660`).
- [x] **9. Admin curation** — Allowlisted sign-in, maker and import controls, pattern review, re-embedding and telemetry (`71ccb3b`).
- [ ] **10. Benchmark and release checks** — Implement the smoke benchmark, then exercise the integrated public and admin flows on staging.

**Verification so far.** Task 8 passed the frozen install, typecheck and production build. The integrated suite passed 242 tests with native PostgreSQL enabled. The live Gemini test was skipped. Desktop and mobile Chrome exercised sample search, technical flats, focus refinement, maker redirect attribution, expired-session recovery and a cropped upload backed by a seeded analysis cache. Desktop and mobile Chrome checks used a local auth fixture and confirmed that maker suspension and restoration immediately affected search results and redirects. The 2,000-view local PGlite benchmark measured p95 at 4.14 ms for full silhouette and 3.12 ms for filtered bodice across 30 warmed calls per case.

**Open staging checks.** Record live Gemini extraction, latency and spend for Task 4. Complete hosted Supabase Auth, Storage and release acceptance under Task 10.

Use the existing feature worktree and `bun.lock`. Run `bun install --frozen-lockfile` on a fresh checkout. Generate each Superpowers task brief from this revision immediately before dispatch and include Global Constraints. Parallel writers on independent tasks use separate worktrees. Give each diff to a reviewer and record the commit and verification in the feature worktree’s progress ledger. The coordinator owns shared migrations and integration order.

## Review Focus

1. **Rotated EXIF mobile photos, HEIC files, and non-image binary uploads:** Mobile camera rolls frequently supply EXIF-rotated JPEGs, `image/heic` containers, or corrupt/0-byte files; client preflight and server `sharp` normalization must auto-orient upright, strip EXIF metadata, and return `415 UNSUPPORTED_IMAGE_FORMAT` cleanly on unsupported/corrupt magic bytes without crashing the route or billing Vision tokens. *(Pinned in Task 5 & Task 6)*
2. **Uppercase, hyphenated, or compound surface-print tokens leaking into `structural_nuance_notes`:** Vision outputs like `"Liberty-floral"`, `"GINGHAM-check"`, or `"navy/ivory Breton-stripe"` must be scrubbed case-insensitively by `sanitizeStructuralNote` without corrupting legitimate construction terms like `"bias-cut"`, `"box-pleat"`, or `"collar-stand"`. *(Pinned in Task 1)*
3. **Metric (`cm`) and fractional-inch (`33½"`, `34 1/2 in`) maker size charts during CSV/Shopify ingestion:** Non-US indie makers list measurements in centimeters (`81–142 cm`) or unicode/slash fractions, which violate inch bounds or break point-in-band filtering unless parsed and converted to canonical decimal inches before DB insert. *(Pinned in Task 1 & Task 7)*
4. **SSRF redirect hop to private/cloud-metadata IPs vs. valid query-string CDN URLs:** Direct image URL fetching must allow valid CDN query parameters (`https://cdn.shopify.com/photo.jpg?v=123`) while re-validating protocol and resolved DNS CIDR on HTTP `301/302` redirect targets so a public URL redirecting to `http://169.254.169.254/` or `127.0.0.1` is aborted prior to socket connect. *(Pinned in Task 5)*
5. **Outbound `/go/[pattern_id]` URL corruption on pre-parameterized or hash-anchored product URLs:** Maker URLs like `https://atelier.example/products/solene?variant=99#sizing` must merge UTM and `affiliate_query_param` keys via `URL` parsing rather than string concatenation so `?` is never duplicated and `#sizing` stays at the end. *(Pinned in Task 6)*

---

## File Structure

```text
package.json
tsconfig.json
next.config.ts
vitest.config.ts
.gitignore
supabase/
  migrations/                                    # Apply ordered SQL migrations for schema, catalog integrity, spend and worker claims
  seed/synthetic-catalog.ts                      # 22 IP-clean synthetic Dress/Top views, Straight+Curve bands, 4 archetypes
public/catalog-media/                            # Original local seed images
scripts/
  db-seed.ts                                     # Seeds a previously migrated development database
  eval/run-benchmark.ts                          # CLI benchmark runner (--smoke & --dataset)
eval/
  fixtures/smoke-v1/manifest.json                # 15 deterministic smoke + print-trap benchmark queries
src/
  lib/
    env.ts                                       # Validated server/public environment config
    db.ts                                        # Queryable interface, pg.Pool singleton, vector SQL helpers
    supabase/server.ts                           # Supabase SSR auth client + storage service client
  modules/
    taxonomy/
      construction-profile.ts                    # Zod ConstructionProfileV1Schema, enums, FocusRegion types
      canonical-serializer.ts                    # Print-token scrubber + deterministic 4-region text serializer
      measurements.ts                            # Fractional-inch & cm-to-inch measurement parser/normalizer
      scoring.ts                                 # Deterministic region-weighted S_struct + S_total combiner
      chips.ts                                   # Deterministic Matched (<=4) & Diff/Minor Hack (<=2) chip builder
    vision/
      types.ts                                   # VisionExtractor, TextEmbedder, RegionVectors interfaces
      gemini-vision-extractor.ts                 # Structured vision extractor with separate live and ingestion settings
      gemini-text-embedder.ts                    # Batched 768-d L2-normalized text embedder
      usage-ledger.ts                            # Daily UTC token/cost ledger & circuit breaker
    search/
      image-ingest.ts                            # Magic-byte/EXIF WebP normalizer + SSRF-hardened URL fetcher
      rate-limit.ts                              # Sliding/fixed-window Postgres IP rate limiter
      hybrid-ranker.ts                           # SQL + pgvector ranker, band resolver, view dedup, relaxation hints
      analyze-service.ts                         # SHA-256 session cache + Vision -> Embed -> query_sessions orchestrator
      client-canvas-preprocess.ts                # Browser <canvas> EXIF-aware <=1280px WebP resizer + cropper
    catalog/
      outbound-url.ts                            # Safe URL UTM + affiliate param merger
      archetypes-repo.ts                         # Curated archetypes reader + 0-LLM session creator
    ingestion/
      parsers.ts                                 # Shopify products.json (Straight/Curve grouping) & CSV parsers
      media-pipeline.ts                          # sharp 800px/1600px WebP variant uploader to catalog-media
      chunk-worker.ts                            # Permission-gated idempotent chunked ingestion worker
    admin/
      auth.ts                                    # Admin allowlist verifier (curator | engineer)
      curation-actions.ts                        # Maker, batch import, Save & Re-Embed, band merge, publish/takedown actions
      telemetry-repo.ts                          # 7d/30d volume, p50/p95 latency, outbound CTR, spend queries
    eval/
      metrics.ts                                 # Top-3 relevance, Print-Trap@3, MRR, NDCG@5, latency gate math
  components/
    upload-dock.tsx                              # Drag-drop, mobile camera, URL paste, pre-crop, archetype cards
    discovery-workspace.tsx                      # Reference rail, Part-Focus pills, session-expired recovery, grid
    sewist-filter-bar.tsx                        # Woven/Knit, single-value Bust/Hip sliders, Format & Skill pills
    pattern-match-card.tsx                       # Cover <-> Front/Back Flat toggle, Matched/Diff chips, /go/[id] CTA
  middleware.ts                                  # Protects /admin/* and /api/admin/*
  app/
    globals.css                                  # Tactile Atelier tokens (linen mat, warm paper, basting accents)
    layout.tsx                                   # Root editorial shell & fonts
    page.tsx                                     # Public Upload Dock + Curated Archetypes RSC
    search/page.tsx                              # Interactive Discovery Workspace
    go/[pattern_id]/route.ts                     # <20ms 302 outbound redirect + after() click logging
    api/v1/search/analyze/route.ts               # Cold upload / URL / archetype search endpoint
    api/v1/search/query/route.ts                 # <80ms Part-Focus & sewability filter refinement endpoint
    api/admin/ingestion/process-chunk/route.ts   # Chunked batch worker endpoint
    admin/
      login/page.tsx
      makers/page.tsx
      imports/page.tsx
      patterns/page.tsx
      patterns/[id]/page.tsx
      telemetry/page.tsx
```

---

### Task 1: Repository Bootstrap, Canonical Garment Taxonomy, Serializer & Measurement Parser

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `src/modules/taxonomy/construction-profile.ts`
- Create: `src/modules/taxonomy/canonical-serializer.ts`
- Create: `src/modules/taxonomy/measurements.ts`
- Test: `tests/taxonomy/taxonomy-and-serializer.test.ts`

**Interfaces:**
- Consumes: none (root module)
- Produces:
  - `FocusRegion = 'full_silhouette' | 'bodice_neckline' | 'sleeves_armscye' | 'skirt_hemline'`
  - `GarmentCategory = 'dress' | 'top'`, `SubstrateCompatibility = 'woven' | 'knit' | 'both'`
  - `DeliveryFormat = 'pdf_a4_letter' | 'pdf_a0' | 'projector' | 'paper_envelope'`
  - `SkillLevel = 'confident_beginner' | 'intermediate' | 'advanced_couture'`
  - `ConstructionProfileV1` & `ConstructionProfileV1Schema` (Zod schema matching Spec §5.2 verbatim)
  - `CanonicalRegionTexts = { full_silhouette: string; bodice_neckline: string; sleeves_armscye: string; skirt_hemline: string | null }`
  - `sanitizeStructuralNote(raw: string): string`
  - `serializeCanonicalRegions(profile: ConstructionProfileV1): CanonicalRegionTexts`
  - `parseMeasurementInches(raw: string | number | null | undefined, unitHint?: 'in' | 'cm'): number | null`

Reviewed at `2251d96`. The branch contains the Bun workspace, Zod taxonomy, canonical serializer and inch parser. Verify compound print removal, preserved construction terms, nullable skirt text and fractional/metric conversions with `bun run test tests/taxonomy/taxonomy-and-serializer.test.ts`.

---

### Task 2: Deterministic Hybrid Scoring Math & Match/Diff Explanation Chips

**Files:**
- Create: `src/modules/taxonomy/scoring.ts`
- Create: `src/modules/taxonomy/chips.ts`
- Test: `tests/taxonomy/scoring-and-chips.test.ts`

**Interfaces:**
- Consumes: `ConstructionProfileV1`, `FocusRegion` from `@/modules/taxonomy/construction-profile`
- Produces:
  - `computeStructuralScore(query: ConstructionProfileV1, candidate: ConstructionProfileV1, region: FocusRegion): number` (returns `[0, 1]`)
  - `combineHybridScore(vectorCosineSim: number, structuralScore: number, alpha?: number): number` (defaults `alpha = 0.55`, clamps `[0, 1]`)
  - `MatchChip = { kind: 'matched' | 'diff'; slot: string; label: string }`
  - `buildExplanationChips(query: ConstructionProfileV1, candidate: ConstructionProfileV1, region: FocusRegion, totalScore: number): { matched: MatchChip[]; diffs: MatchChip[] }`

Reviewed at `792396a`. The regression suite checks category and regional weights, top-only redistribution, the 0.55 hybrid coefficient and chip limits (four matched and two differences, with differences starting at 0.62). Run `bun run test tests/taxonomy/scoring-and-chips.test.ts`.

---

### Task 3: PostgreSQL + `pgvector` Schema, Publish Trigger, RLS & Stage-A Synthetic Seed Catalog

**State.** Complete and independently reviewed. The seed contains six fictional makers, 18 patterns, 22 views and four archetypes. Migration 002 is verified on fresh and upgraded PGlite databases. The 68 original WebP files ship in `public/catalog-media/`.

**Files**

- Extend `tests/db/schema-and-seed.test.ts`, `supabase/seed/synthetic-catalog.ts`, `src/lib/db.ts` and the seed media resolver in `src/lib/supabase/server.ts`.
- Add `supabase/migrations/202611220002_catalog_integrity.sql` and original local fixtures under `public/catalog-media/`. Keep genuine maker media in the configured Storage bucket.
- Retain `Queryable` from `src/lib/db.ts`. Its result always contains `rows`; pg supplies `rowCount` and PGlite supplies `affectedRows`. Use `RETURNING` when later actions need to distinguish a changed row. Keep `withTransaction`, `toVectorLiteral` and `seedSyntheticCatalog` as entry points.

- [x] **Write regression tests.** A band with a different maker from its pattern must fail on insert and update. A pending or suspended maker cannot enqueue an import. Approval followed by suspension hides that maker's published patterns, bands and views from both public roles. Verify that public reads exclude permission evidence notes, including with deployment-style preexisting table grants.
- [x] **Resolve the schema and transaction findings.** Enforce the pair with a composite foreign key, and check maker approval at batch creation or reassignment. Keep ordinary curation drafts possible. In an upgrade test, apply the original migration, seed representative rows and then apply the new migration. Report inconsistent legacy ownership for correction before validating the constraint. In a separate fresh database, apply all migrations in order. Revoke table-wide maker reads for public roles and grant only the columns needed for catalog display and policy evaluation. Exercise `withTransaction` on a pool, an already acquired client and PGlite, verifying rollback and releasing only connections acquired by the helper.
- [x] **Repair the local catalog.** Ship original covers, technical flats and archetype images for all non-null seeded paths. Make synthetic media resolve locally even when Supabase is configured. Verify the files decode, that cover/front/back are distinct when present, and that each archetype's displayed garment and profile agree. Replace the positional dress reference for `surplice-wrap-flutter-top` with a matching named top fixture. Run the seed twice and verify stable IDs and counts. Preserve maker suspensions and pattern takedowns on rerun.
- [x] **Verify and review.** Run `bun run test tests/db/schema-and-seed.test.ts` and `bun run typecheck`. Accept when the original guardrails and new regression cases pass. Include a visual spot-check of the local fixtures. Record the fix commit and independent review before closing Task 3.

---

### Task 4: Multimodal Vision Extractor, Batched 768-d Text Embedder & Daily Spend Circuit Breaker

**Files:**
- Modify: `src/lib/env.ts` for validated model configuration and cost estimates. Add `supabase/migrations/202611220003_ai_budget.sql` for in-flight daily spend reservations.
- Create: `src/modules/vision/types.ts`
- Create: `src/modules/vision/gemini-vision-extractor.ts`
- Create: `src/modules/vision/gemini-text-embedder.ts`
- Create: `src/modules/vision/usage-ledger.ts`
- Test: `tests/vision/vision-and-budget.test.ts`

**Interfaces:**
- Consumes: `ConstructionProfileV1`, `CanonicalRegionTexts` from `@/modules/taxonomy/*`; `Queryable` from `@/lib/db`
- Produces:
  - `RegionVectors = { full: number[]; bodice: number[]; sleeves: number[]; skirt: number[] | null }`
  - `VisionExtractionMode = 'live_query' | 'catalog_ingestion'`
  - `VisionExtractionResult = { status: 'ok' | 'no_garment_detected' | 'unsupported_category_v1' | 'low_visibility_partial'; profile: ConstructionProfileV1 | null; aiConfidence: number; warnings: string[]; inputTokens: number; outputTokens: number }`
  - `VisionExtractor = { extract(input: { images: Array<{ mimeType: string; bytes: Buffer; role?: string }>; contextText?: string; mode: VisionExtractionMode }): Promise<VisionExtractionResult> }`
  - `TextEmbedder = { embedRegions(texts: CanonicalRegionTexts, taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'): Promise<{ vectors: RegionVectors; inputTokens: number }> }`
  - `withBudgetedUsage<T>(db: Queryable, request: { id: string; operation: UsageOperation; maxCostUsd: number }, call: () => Promise<{ value: T; inputTokens: number; outputTokens: number; estimatedCostUsd: number }>): Promise<T>`. The adapter owns this call. Treat admin re-embedding as `ingest_embed`.
  - `assertDailyBudgetAvailable(db: Queryable, dailyCapUsd?: number): Promise<void>` (throws `BudgetExceededError` with `statusCode = 503` when UTC day sum `>= dailyCapUsd`)
  - `UsageOperation = 'search_vision' | 'search_embed' | 'ingest_vision' | 'ingest_embed'`.
  - `recordApiUsage(db: Queryable, delta: { operation: UsageOperation; inputTokens: number; outputTokens: number; estimatedCostUsd: number }): Promise<void>`

**Model compatibility decision.** The spec pins Gemini 2.5 Flash and numeric thinking budgets. Google schedules that model ID to route to Gemini 3.5 Flash-Lite on December 1, 2026. Use the successor's explicit ID as the staging candidate, with minimal thinking for live extraction and medium for offline ingestion. Keep the embedding model, task types, 768 dimensions and provider-independent interfaces from the spec. Check the structured JSON MIME type, response schema, model-specific thinking setting and output bound against the installed SDK. Derive the profile schema from the taxonomy and validate the returned envelope at runtime. Record the actual model ID, price basis, latency and extraction results before selecting it for production. [Provider schedule](https://ai.google.dev/gemini-api/docs/deprecations) · [Supported thinking levels](https://ai.google.dev/gemini-api/docs/thinking)

**Consumer handoff.** Instantiate `createGeminiVisionExtractor(db)` and `createGeminiTextEmbedder(db)` with the autocommit database pool so a later application rollback cannot undo paid usage. Create them on a cold AI path. Active sessions and archetypes can run without Gemini credentials. Both factories accept an injected client for offline tests. Budget errors carry HTTP status 503.

**Staging evidence.** With `GEMINI_API_KEY`, a staging `DATABASE_URL` migrated through 003, and an available daily budget, run `SEAMLENS_GEMINI_STAGING=1 bun run test tests/vision/gemini-staging.test.ts`. The check uses the bundled square-neck dress, validates all four region vectors and prints the selected model IDs, price basis, timings and extraction summary. Default standard rates in USD per million tokens are 0.30 for vision input, 2.50 for vision output including thinking, and 0.15 for embedding input. [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)

- [x] **Step 1. Write adapter and spend tests.** With a recording fake client, assert one structured extraction request per garment with one inline image part per supplied view and the intended model-specific settings for each mode. Validate the response envelope, confidence in [0,1], allowed status and Zod profile. An unusable or malformed response produces a typed failure. A no-garment response carries no profile. A partial or unsupported response can carry a usable upper-body profile for Part-Focus.
- [x] **Step 2. Test embeddings and contention.** Assert one batch maps four regions in order for a dress and three for a top, with a null skirt. Reject a missing vector, non-finite element, zero norm or incorrect dimension. Assert unit norm for each usable vector. In a migrated database, race two reservations when only one fits, settle the winner once, and test the UTC boundary. Run `bun run test tests/vision/vision-and-budget.test.ts` and observe failure before implementation.
- [x] **Step 3. Implement and account for paid calls.** Give technical flats priority, target the foreground garment, flag multiple garments, and keep print and color out of the structural notes. Send non-null canonical region strings as separate embedding inputs in a single request to `gemini-embedding-001` with `outputDimensionality: 768`, the caller’s retrieval task type and L2 normalization. Centralize the budget wrapper in `usage-ledger.ts` for live extraction, ingestion and admin re-embedding. Reserve a conservative upper cost atomically against the UTC day's cap before each paid call, using bounded inputs/outputs and configured model rates. Settle the reservation and actual or conservatively estimated usage once using its request ID. Release on a confirmed unbilled failure and keep unknown billing outcomes covered. Persist billed extraction usage even if embedding or later database work fails. Mock providers in routine tests.
- [ ] **Live acceptance.** Run the staging fixture above and record the observed extraction, timings and price basis before production model selection.

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/vision/vision-and-budget.test.ts`
Expected: PASS. The independent PostgreSQL contention test also runs when `SEAMLENS_TEST_POSTGRES_URL` points to a scratch PostgreSQL server with database creation rights. It creates and removes its own database.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/modules/vision src/lib/env.ts supabase/migrations/202611220003_ai_budget.sql tests/vision
git commit -m "feat(vision): add structured Gemini extractor, batched 768-d embedder, and daily spend circuit breaker"
```

---

### Task 5: Image Input Hardening (EXIF/Magic Bytes & SSRF), Rate Limiter & Hybrid Search Engine

**Files:**
- Create: `src/modules/search/image-ingest.ts`
- Create: `src/modules/search/rate-limit.ts`
- Create: `src/modules/search/hybrid-ranker.ts`
- Create: `src/modules/search/analyze-service.ts`
- Test: `tests/search/image-security-and-ranker.test.ts`
- Amend `src/modules/taxonomy/scoring.ts` and `tests/taxonomy/scoring-and-chips.test.ts` for the top-only weighting correction from spec §5.4.3.

**Interfaces:**
- Consumes: `@/modules/taxonomy/*`, `@/modules/vision/*`, `@/lib/db`
- Produces:
  - `CropBox = { x: number; y: number; width: number; height: number }` in normalized upright-image coordinates. Validate finite values, positive dimensions and containment.
  - `AnalyzeDeps = { db: Queryable; visionExtractor: VisionExtractor; textEmbedder: TextEmbedder }`. Inject budgeted adapters in the live composition root. Offline fixtures implement the same interfaces.
  - `AnalyzeInput = ({ source: 'upload'; bytes: Buffer } | { source: 'url'; imageUrl: string }) & { cropBox?: CropBox | null; focusRegion: FocusRegion; filters: SearchFilters }`. Task 6 handles archetypes. Export `SearchExecutionResult` from the ranker as the awaited return type of `executeSessionSearch`.
  - `SearchError` (`code: 'UNSUPPORTED_IMAGE_FORMAT' | 'SSRF_BLOCKED' | 'HTML_PAGE_URL_UNSUPPORTED' | 'NO_GARMENT_DETECTED' | 'SESSION_EXPIRED' | 'RATE_LIMITED' | 'INVALID_INPUT' | 'IMAGE_TOO_LARGE' | 'UNSUPPORTED_CATEGORY_V1' | 'REGION_UNAVAILABLE'`, `statusCode: number`)
  - `validateAndNormalizeServerImage(raw: Buffer, cropBox?: CropBox | null): Promise<{ webpBytes: Buffer; sha256: string; width: number; height: number }>`
  - `SafeImageTransport` supplies hostname resolution and HTTPS requests to a selected resolved address, preserving the original host for TLS.
  - `fetchDirectImageUrlSafe(rawUrl: string, deps?: SafeImageTransport): Promise<Buffer>`
  - `enforceRateLimit(db: Queryable, ipHash: string, bucket: 'analyze_min' | 'analyze_hr' | 'query_min', limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }>`
  - `SearchFilters = { substrate?: 'woven' | 'knit' | null; userBustIn?: number | null; userHipIn?: number | null; formats?: DeliveryFormat[]; skills?: SkillLevel[] }`
  - `RankedPatternCard = { patternId: string; viewId: string; viewLabel: string; secondaryViewCount: number; garmentCategory: GarmentCategory; title: string; makerName: string; coverImageUrl: string; flatFrontImageUrl: string | null; flatBackImageUrl: string | null; matchedSizeBandId: string; priceCents: number | null; currency: string; bustRangeIn: [number, number]; hipRangeIn: [number | null, number | null]; designerSizeLabel: string; substrateType: SubstrateCompatibility; formats: DeliveryFormat[]; skillLevel: SkillLevel; totalScore: number; matchedChips: MatchChip[]; diffChips: MatchChip[] }`
  - `CandidateReranker = { rerank(query: ConstructionProfileV1, focusRegion: FocusRegion, candidates: RankedPatternCard[]): Promise<RankedPatternCard[]> }` (default `noopCandidateReranker` returning `candidates` unchanged—pluggable Stage-2 flat reranker seam per Spec §4)
  - `executeSessionSearch(db: Queryable, querySessionId: string, focusRegion: FocusRegion, filters: SearchFilters, reranker?: CandidateReranker): Promise<{ querySessionId: string; queryStatus: 'ok' | 'low_visibility_partial' | 'unsupported_category_v1'; extractedProfile: ConstructionProfileV1; warnings: string[]; results: RankedPatternCard[]; relaxationHints: Array<{ facet: keyof SearchFilters; resultCount: number; label: string }> }>`
  - `analyzeAndSearch(deps: AnalyzeDeps, input: AnalyzeInput): Promise<SearchExecutionResult>`

- [x] **Step 1: Write failing tests for EXIF/HEIC rejection, SSRF redirect blocking, rate limits, and hybrid ranking**

Create `tests/search/image-security-and-ranker.test.ts` covering:
1. **Review Focus #1:** Rotate-tagged EXIF JPEG (`Orientation = 6`, `800x1200` stored sideways as `1200x800`) normalizes to upright `width < height` WebP with EXIF stripped; fake HEIC (`ftypheic` header) and 0-byte buffers throw `SearchError('UNSUPPORTED_IMAGE_FORMAT', 415)`.
2. **Review Focus #4:** `fetchDirectImageUrlSafe` accepts `https://cdn.example.com/look.jpg?w=1080` resolving to `93.184.216.34`, blocks `http://...`, blocks `169.254.169.254` / `127.0.0.1` / `10.0.0.1` / `::1`, blocks an `https://public.example/img` that returns `302 Location: https://internal.example/meta` resolving to `169.254.169.254`, and throws `HTML_PAGE_URL_UNSUPPORTED` (`422`) when `Content-Type: text/html` is returned (e.g. Instagram post URL).
3. **Hybrid SQL + `pgvector` Ranker:** Against the seeded `PGlite` database:
   - `full_silhouette` floral square-neck puff midi query ranks the woven square-neck midi dress #1 and keeps the floral t-shirt decoy out of Top-3.
   - Switching `focusRegion` to `'bodice_neckline'` includes matching `'top'` blocks alongside `'dress'` views.
   - Setting `userBustIn: 52, userHipIn: 56` matches the Curve band (`44"–62"`), sets `matchedSizeBandId` to the Curve `pattern_size_bands.id`, and still lets the nullable-hip cropped top pass under `bodice_neckline`.
   - Deduplicates multi-view patterns by `pattern_id` (`secondaryViewCount >= 1`) and emits `relaxationHints` when strict `formats: ['projector']` + `skills: ['advanced_couture']` yields 0 matches.
   - Repeating `analyzeAndSearch` with identical image bytes hits `query_sessions` by `image_sha256` with `0` additional `VisionExtractor` calls.

4. Test hard filters with bust and hip split across two bands so neither band qualifies. Apply OR within each facet and AND across facets. A top queried on skirt focus gets a typed 422 response and an available focus choice. Log one search event per successful analyze, archetype or refinement, including cache hits.
5. Exercise no garment (422, zero session writes), unsupported lower-body-only input (422, category guidance), a usable partial upper body (session and bodice/sleeve refinement), and a cropped or ambiguous silhouette (both categories eligible). Never invent a dress or top profile to satisfy a database constraint.
6. Test the actual rate-limit boundaries, UTC-window reset and `Retry-After` using a controlled clock. Debit IP windows once at the HTTP boundary. Test that valid cached analyses, archetypes and refinements make zero paid calls after the spend cap trips. Only cold misses enter Task 4's budget wrapper.
7. For a full-silhouette top with identical geometry but both substrate and closure mismatched, assert a structural score of 0.90. The current division by 0.80 inflates those two slots as well. Keep their combined 0.10 and redistribute the missing skirt share only across silhouette, bodice and sleeves (scale their 0.70 total to 0.90).
8. The URL transport must connect to a validated public address for each hop and preserve HTTPS hostname verification. Bound the entire fetch, streamed byte count and decoded pixels. Use an injected resolver/transport in offline tests and assert the chosen address is the one used to connect. Cover upload size, timeouts and content validation before AI work.

- [x] **Step 2: Run test to verify it fails**

Run: `bun run test tests/search/image-security-and-ranker.test.ts`
Expected: FAIL with missing `@/modules/search/*` modules.

- [x] **Step 3: Implement `image-ingest.ts`, `rate-limit.ts`, `hybrid-ranker.ts`, and `analyze-service.ts`**

- In `image-ingest.ts`: verify magic bytes (`FF D8 FF` JPEG, `89 50 4E 47` PNG, `RIFF....WEBP` WebP, `....ftypavif` AVIF; explicitly reject `ftypheic`/`ftypheix` and anything else with `415`), apply optional normalized `cropBox` after `sharp(raw).rotate()` (so crop coordinates align with upright display!), resize `fit: 'inside', width: 1280, height: 1280, withoutEnlargement: true`, output `.webp({ quality: 82 })`, compute `sha256`. In `fetchDirectImageUrlSafe`, use `redirect: 'manual'`, validate URL + DNS lookup against private IPv4/IPv6 CIDR ranges on hop 0 and at most 1 redirect hop, stream up to `8 * 1024 * 1024` bytes with `AbortSignal.timeout(3000)`.
- In `hybrid-ranker.ts`: inside a transaction, `SET LOCAL hnsw.iterative_scan = relaxed_order;`, fetch `query_sessions` row (`expires_at > now()`, else throw `404 SESSION_EXPIRED`), retrieve up to 40 distinct view IDs by region cosine distance, using the approved maker, published pattern and a matching size band (`EXISTS` predicate from Spec §5.4.3), compute `combineHybridScore(vecSim, computeStructuralScore(...))`, collapse by `pattern_id`, return the best 18 distinct patterns with stable tie-breaking, select a band satisfying both measurements, preferring the qualifying default then a stable ID. With both measurements unset, prefer the default across all bands, attach `buildExplanationChips`, and run single-facet relaxation counts when `results.length === 0`.
- In `analyze-service.ts`: after route-level rate limiting, normalize and check unexpired sessions by normalized image digest and effective crop, on a miss run the budgeted `VisionExtractor` (`mode: 'live_query'`) + `serializeCanonicalRegions` + `TextEmbedder` (`RETRIEVAL_QUERY`), insert `query_sessions` + `search_events`, probabilistically `DELETE FROM query_sessions WHERE expires_at < now()`, and return `executeSessionSearch(...)`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/search/image-security-and-ranker.test.ts tests/taxonomy/scoring-and-chips.test.ts`
Expected: PASS.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/modules/search tests/search src/modules/taxonomy/scoring.ts tests/taxonomy/scoring-and-chips.test.ts
git commit -m "feat(search): add SSRF/EXIF-safe image ingest, IP rate limiter, and hybrid pgvector ranker"
```

---

### Task 6: Public Search API Routes, Tracked `/go/[pattern_id]` Redirect & Client Canvas Preprocessor

**Files:**
- Create: `src/modules/catalog/outbound-url.ts`
- Create: `src/modules/catalog/archetypes-repo.ts`
- Create: `src/app/api/v1/search/analyze/route.ts`
- Create: `src/app/api/v1/search/query/route.ts`
- Create: `src/app/go/[pattern_id]/route.ts`
- Create: `src/modules/search/client-canvas-preprocess.ts`
- Test: `tests/api/public-routes-and-redirect.test.ts`

**Interfaces:**
- Consumes: `@/modules/search/*`, `@/lib/db`
- Produces:
  - `buildTrackedDestinationUrl(productUrl: string, utmCampaignSlug: string, affiliateQueryParam?: string | null): string`
  - `CuratedArchetypeSummary = { slug: string; title: string; caption: string; imageUrl: string; defaultFocusRegion: FocusRegion }`.
  - `listActiveArchetypes(db: Queryable): Promise<CuratedArchetypeSummary[]>`
  - `createSessionFromArchetype(db: Queryable, slug: string): Promise<string>` (inserts `query_sessions` from `curated_archetypes`, zero LLM calls)
  - `POST /api/v1/search/analyze` (`multipart/form-data` `file` + optional `focusRegion`/`cropBox`/`filters`, OR JSON `{ imageUrl, cropBox?, focusRegion, filters } or { archetypeSlug, focusRegion, filters }`)
  - `POST /api/v1/search/query` (JSON `{ querySessionId, focusRegion, filters }`)
  - `GET /go/[pattern_id]?band=&q=&v=&pos=&region=` (`302` redirect + async `outbound_clicks` insert)
  - `preprocessGarmentFileInBrowser(file: File, cropBox?: CropBox | null): Promise<{ blob: Blob; previewDataUrl: string }>`

- [x] **Step 1: Write failing tests for URL merging, archetype instant search, API routes, and `/go/[pattern_id]`**

In `tests/api/public-routes-and-redirect.test.ts` exercise exported handlers with real Request objects and injected dependencies.

- A file or URL creates one session and debits each applicable IP bucket once. Reject missing or conflicting sources, invalid filters and out-of-bounds crop coordinates with 400. Map size, format, HTML, expiration, throttling and budget failures to 413/415/422/404/429/503 with a stable JSON `code`. Check the 429 retry header. Use the trusted platform client address and a deployment-provided salt.
- A curated archetype returns results at the cap, consumes the read bucket, and uses zero model calls. A follow-up query changes focus without inference. Measure refinement latency on staging under Task 10.
- Use a known asymmetric fixture. Cropping a browser upload once and cropping the equivalent URL image on the server select the same region. When the browser submits a cropped blob, omit crop coordinates from that request. Reject HEIC before upload. Keep multipart requests under the deployment body limit through client resizing and byte-limit checks. The direct fetch has its own 8 MiB stream limit. [Vercel function limits](https://vercel.com/docs/functions/limitations)
- Select a Curve band and verify 302, the exact maker product URL, preservation of existing query parameters and fragment, and one attributed click after executing the queued callback. Foreign band/view IDs cannot change destination or attribution. An unpublished pattern or suspended maker returns 404. Accept only validated HTTP(S) maker destinations and keep redirects uncached so a takedown takes effect on the next click.

- [x] **Step 2: Run test to verify it fails**

Run: `bun run test tests/api/public-routes-and-redirect.test.ts`
Expected: FAIL with missing route/catalog files.

- [x] **Step 3: Implement `outbound-url.ts`, `archetypes-repo.ts`, Route Handlers, and `client-canvas-preprocess.ts`**

- Implement `buildTrackedDestinationUrl` using `new URL(productUrl)` and `URLSearchParams(affiliateQueryParam)` so existing query strings and `#hash` fragments never break.
- Implement `POST /api/v1/search/analyze` (`export const runtime = 'nodejs'; export const maxDuration = 30;`) enforcing `10/min` and `40/hr` IP rate limits on live Vision requests (exempting `archetypeSlug` from Vision rate/budget gates, using the `120/min` query bucket instead), and `POST /api/v1/search/query` enforcing `120/min`.
- Implement `GET /go/[pattern_id]/route.ts` (`status = 'published'` AND `vetted_status = 'approved'`), resolving `?band=` against `pattern_size_bands` (`pattern_id = $1`, fallback `is_default = true`), scheduling `INSERT INTO outbound_clicks` via `after()` from `next/server` (inject a callback scheduler in tests), and returning `NextResponse.redirect(destinationUrl, 302)`.
- Implement `preprocessGarmentFileInBrowser` rejecting `.heic`/`.heif` with a clear prompt to upload JPEG/PNG/WebP/screenshot, drawing via `createImageBitmap` (`imageOrientation: 'from-image'`) onto `<canvas>` (`<=1280px`), and exporting `image/webp` at `0.82`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/api/public-routes-and-redirect.test.ts`
Expected: PASS.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/modules/catalog src/modules/search/client-canvas-preprocess.ts src/app/api/v1 src/app/go tests/api
git commit -m "feat(api): add search analyze/query endpoints, tracked /go redirect, and client canvas preprocessor"
```

---

### Task 7: Permissioned Batch Catalog Ingestion Pipeline (Shopify JSON & Canonical CSV)

**Files:**
- Add `supabase/migrations/202611220004_ingestion_claims.sql` for expiring worker claims, ownership tokens and a stable unique item key within a batch.
- Create: `src/modules/ingestion/parsers.ts`
- Create: `src/modules/ingestion/media-pipeline.ts`
- Create: `src/modules/ingestion/chunk-worker.ts`
- Test: `tests/ingestion/parsers-and-worker.test.ts`

**Interfaces:**
- Consumes: `parseMeasurementInches`, `ConstructionProfileV1`, `serializeCanonicalRegions` from `@/modules/taxonomy/*`; `VisionExtractor`, `TextEmbedder`, `recordApiUsage` from `@/modules/vision/*`; `Queryable` from `@/lib/db`
- Produces:
  - `IngestionWorkerDeps` supplies the Task 3 database, budgeted Task 4 vision and embedding adapters, a gallery classifier returning image roles grouped by view, and a catalog media writer. Compose these in the Node.js chunk handler. Charge gallery classification to ingestion vision.
  - `RawSizeBandCandidate = { externalProductId: string | null; bandLabel: string; isDefault: boolean; productUrl: string; priceCents: number | null; currency: string; designerSizeLabel: string | null; bustMinIn: number | null; bustMaxIn: number | null; hipMinIn: number | null; hipMaxIn: number | null }`
  - `NormalizedImportDraft = { groupKey: string; title: string; garmentCategoryHint?: 'dress' | 'top' | 'dress_and_top_set'; substrateHint?: SubstrateCompatibility; formatsHint: DeliveryFormat[]; skillHint?: SkillLevel; descriptionHtml: string; imageUrls: Array<{ url: string; roleHint?: 'cover' | 'flat_front' | 'flat_back' }>; sizeBands: RawSizeBandCandidate[]; explicitViews?: Array<{ viewCode: string; viewLabel: string }> }`
  - `parseShopifyProductsJson(json: unknown, storefrontBaseUrl: string): NormalizedImportDraft[]`
  - `parseSeamLensCsv(csvText: string): NormalizedImportDraft[]`
  - `enqueueIngestionBatch(db: Queryable, params: { makerId: string; sourceType: 'shopify_json' | 'csv_upload'; sourceDescriptor: string; drafts: NormalizedImportDraft[]; createdBy: string }): Promise<{ batchId: string; itemCount: number }>`
  - `processNextIngestionChunk(deps: IngestionWorkerDeps, batchId: string, chunkSize?: number): Promise<{ processed: number; completed: number; failed: number; status: string }>`

- [x] **Step 1: Write failing tests for Straight/Curve Shopify grouping, metric CSV parsing, permission gate, and idempotent chunk execution**

Use `tests/ingestion/parsers-and-worker.test.ts` with an in-memory database, original media, a fake object store and recording AI adapters.

- Two Shopify sibling listings from one maker produce one design and two distinct bands. A quoted CSV description containing commas or newlines stays in one field. Assert `84 cm → 33.1 in`, `137 cm → 53.9 in` and `33½" → 33.5 in`. Re-import the same CSV with no external product ID and verify stable design, band and view counts.
- A pending maker cannot enqueue. Suspend an approved maker after enqueue and confirm that processing consumes zero paid calls. Suspend during processing and verify that final draft writes recheck approval.
- Two workers claiming the same batch cannot complete the same item twice. Simulate interruption after media upload and before draft commit, reclaim the expired claim, and verify stable media keys, one set of bands/views and consistent batch totals. Retrying a failed item updates its existing queue entry.
- A gallery with front, back, cover, an irrelevant image and two described garment views yields the expected role-to-view assignments. Give explicit CSV roles precedence and prefer flats during extraction. Missing required measurements remain in a reviewable item linked to its draft. A fabricated measurement or a forced insert into a non-null bust column fails this test. Retain candidates in the ingestion payload until the curator supplies valid bounds. An item below 0.80 confidence must appear in the review queue.

- [x] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ingestion/parsers-and-worker.test.ts`
Expected: FAIL with missing `@/modules/ingestion/*` modules.

- [x] **Step 3: Implement `parsers.ts`, `media-pipeline.ts`, and `chunk-worker.ts`**

- In `parsers.ts`: normalize Shopify titles by stripping trailing Curve/Plus/Extended/Straight size-range suffixes (`/\s*[-–(]*(curve|plus|extended|straight|sizes?\s*\d+[\s–-]+\d+).*$/i`) to form `groupKey`, merging sibling Straight & Curve products into one `NormalizedImportDraft` with distinct `RawSizeBandCandidate` entries; parse CSV rows supporting multi-view (`view_code`) and multi-band (`band_label`) grouping, applying `parseMeasurementInches` (detecting `cm` headers/values automatically).
- In `media-pipeline.ts`: resize approved cover & flat images via `sharp` into `800px` (`-card.webp`) and `1600px` (`-full.webp`) uploaded to `catalog-media/{maker_slug}/{pattern_slug}/...`.
- In `chunk-worker.ts`: verify `makers.vetted_status === 'approved'` before both enqueue and chunk execution; claim up to `chunkSize = 3` `'queued'` items (`FOR UPDATE SKIP LOCKED`), run `VisionExtractor` (`mode: 'catalog_ingestion'`, passing technical flats first), serialize & embed all 4 regions, upsert `patterns (status = 'draft')`, `pattern_size_bands` (`ON CONFLICT (maker_id, external_product_id) DO UPDATE`), and `pattern_views (human_verified = false)`.

- Commit the claim before external work. Fetch approved catalog sources and gallery media through a bounded HTTPS transport with the same address policy as Task 5. Task 7 can develop against an injected transport in parallel and wire the shared implementation at integration. Use deterministic Storage keys. In a short transaction, verify claim ownership and maker status, then persist the draft, review flags, item stage and counts together. Re-importing a curated or published design must preserve its verified fields and publication state for explicit admin review.

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/ingestion/parsers-and-worker.test.ts`
Expected: PASS.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/modules/ingestion supabase/migrations/202611220004_ingestion_claims.sql tests/ingestion
git commit -m "feat(ingestion): add Shopify Straight/Curve grouping parser, metric CSV parser, and chunked draft worker"
```

---

### Task 8: Tactile Atelier Public Discovery Frontend (`/` & `/search`)

**Files:**
- Create: `src/app/globals.css`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/search/page.tsx`
- Create: `src/components/upload-dock.tsx`
- Create: `src/components/discovery-workspace.tsx`
- Create: `src/components/sewist-filter-bar.tsx`
- Create: `src/components/pattern-match-card.tsx`
- Test: `tests/ui/discovery-flow.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/search/analyze`, `POST /api/v1/search/query`, `GET /go/[pattern_id]`, `listActiveArchetypes`, `preprocessGarmentFileInBrowser`, `RankedPatternCard`, `FocusRegion`, `SearchFilters`
- Produces:
  - Public landing & upload page (`/`) and interactive search workspace (`/search?q=[querySessionId]`)

- [x] **Step 1: Write failing component interaction tests for Upload Dock, Part-Focus, Filter Sliders, Flat Toggle & Session Recovery**

Use `tests/ui/discovery-flow.test.tsx` in jsdom. Exercise the rendered components through their labeled controls.

- Choose an archetype or submit a prepared upload, navigate to `/search?q=<sessionId>`, and assert that the initial focus, reference preview and first results survive navigation. A matched band CTA carries the pattern, band and view from the displayed card.
- Toggle cover/front/back and verify the actual image URL. Hide unavailable flats. Show the union size range on the card and link to the specific qualifying band. Move each measurement control, then choose Any and inspect the outgoing JSON for a single number followed by null.
- Make two refinements and resolve the older request last. Only the latest choice can update the grid. For an expired session recover once from the retained upload, archetype slug or URL. Preserve the current filters and focus. If the original source is unavailable or recovery fails, offer a fresh upload.
- Show the Dresses & Tops scope message for unsupported garments, upper-body focus choices when available, crop guidance for multiple garments, and actionable filter relaxation hints. At the daily cap a user can still start from an archetype.

- [x] **Step 2: Run test to verify it fails**

Run: `bun run test tests/ui/discovery-flow.test.tsx`
Expected: FAIL with missing components.

- [x] **Step 3: Implement Tactile Atelier styling and public discovery components (zero `mockups/` imports)**

- In `src/app/globals.css` & `src/app/layout.tsx`: define clean Atelier CSS custom properties inspired by *Fold Atelier* and *Kripalani Tailors* (woven raw-linen ground `#E5E2DC`, warm drafting-paper card surface `#FAF8F4`, charcoal ink `#1D1E1C`, tailor's chalk & terracotta basting accents `#B84A32`, generous whitespace, `Fraunces` / `Instrument Serif` display + `Plus Jakarta Sans` body + `JetBrains Mono` measurement tags).
- Implement `UploadDock` (drag-drop, mobile camera `accept="image/jpeg,image/png,image/webp,image/avif"`, URL input surfacing friendly screenshot hint on `HTML_PAGE_URL_UNSUPPORTED`, optional pre-search Part-Focus & crop box, one-click Curated Archetype cards; caches resized blob/dataUrl in client memory + `sessionStorage` keyed by `querySessionId`).
- Implement `DiscoveryWorkspace`, `SewistFilterBar` (Woven/Knit pills, single-value *My Full Bust* `32"–64"+` and *My Full Hip* `32"–68"+` sliders with `Any` reset, Format & Skill multi-select pills), and `PatternMatchCard` (Cover ↔ Front/Back Technical Flat toggle with `<link rel="preload">` / hidden eager image warm-up, **Matched** sage chips, **Diff / Minor Hack** ochre chips, canonical + designer band sizing readout, direct `/go/[pattern_id]` CTA).

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/ui/discovery-flow.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/page.tsx src/app/search src/components tests/ui
git commit -m "feat(ui): build Tactile Atelier upload dock, part-focus workspace, sewist filter bar, and flat-toggle match cards"
```

---

### Task 9: Atelier Admin Curation Dashboard, Auth Middleware & Automatic Re-Embed Sync

**Files:**
- Create: `src/modules/admin/auth.ts`
- Create: `src/modules/admin/curation-actions.ts`
- Create: `src/modules/admin/telemetry-repo.ts`
- Create: `src/middleware.ts`
- Create: `src/app/api/admin/ingestion/process-chunk/route.ts`
- Create: `src/app/admin/login/page.tsx`
- Create: `src/app/admin/makers/page.tsx`
- Create: `src/app/admin/imports/page.tsx`
- Create: `src/app/admin/patterns/page.tsx`
- Create: `src/app/admin/patterns/[id]/page.tsx`
- Create: `src/app/admin/telemetry/page.tsx`
- Test: `tests/admin/curation-and-auth.test.ts`

**Interfaces:**
- Consumes: `@/modules/taxonomy/*`, `@/modules/vision/*`, `@/modules/ingestion/*`, `@/lib/db`, `@/lib/supabase/server`
- Produces:
  - `requireAdminUser(db: Queryable): Promise<{ userId: string; email: string; role: 'curator' | 'engineer' }>`
  - `SizeBandInput` carries the optional existing band ID, label, default flag, product URL, price, currency, designer size label, and validated bust/hip bounds from the Task 3 schema. Resolve maker and parent IDs from the view. `CurationDeps` contains the database and budgeted document embedder.
  - `TelemetrySummary` returns searches, clicks, outbound CTR (clicks / searches, zero when empty), p50/p95 search latency, per-maker click counts and current UTC-day spend. Count successful searches once from `search_events`.
  - `savePatternViewCuration(deps: CurationDeps, input: { viewId: string; constructionProfile: ConstructionProfileV1; sizeBands: SizeBandInput[]; substrateType: SubstrateCompatibility; formats: DeliveryFormat[]; skillLevel: SkillLevel; expectedUpdatedAt: string }): Promise<void>`
  - `setPatternPublishStatus(db: Queryable, patternId: string, status: 'draft' | 'published' | 'unpublished' | 'takedown'): Promise<void>`
  - `mergeSizeBandIntoPattern(db: Queryable, sourcePatternId: string, targetPatternId: string, bandLabel: string): Promise<void>`
  - `getTelemetrySummary(db: Queryable, windowDays: 7 | 30): Promise<TelemetrySummary>`

- [x] **Step 1: Write failing tests for Admin allowlist guard, Save & Re-Embed sync, maker suspension cascade, and CTR telemetry**

Use `tests/admin/curation-and-auth.test.ts` to drive the protected actions and chunk handler as well as the page guard.

- Unauthenticated requests fail or redirect to login. A signed-in user absent from `admin_users` receives 403 from direct mutation and chunk requests. A curator can complete the intended action. Resolve identity from verified Supabase auth on the server and record that user's ID in the audit fields.
- Edit a neckline and verify that the saved profile, canonical strings, normalized vectors and reviewer all change together. An embedding failure, stale revision or failed band validation preserves the previous complete version. Verify admin re-embedding is budgeted and counted once.
- Merge a duplicate draft within the same maker and verify two bands on the target. Reject cross-maker merges and preserve referenced audit rows. Publish, unpublish, suspend and takedown are immediately reflected in search and redirect checks.
- Verify that the queue includes incomplete imports, an admin can fill missing band bounds, and a failed item can be retried without creating a second item. Supply known search/click fixtures over 7 and 30 days and assert exact counts, per-maker clicks, latency percentiles, daily spend, CTR and a zero-search denominator.

- [x] **Step 2: Run test to verify it fails**

Run: `bun run test tests/admin/curation-and-auth.test.ts`
Expected: FAIL with missing `@/modules/admin/*` modules.

- [x] **Step 3: Implement `auth.ts`, `curation-actions.ts`, `telemetry-repo.ts`, `middleware.ts`, and `/admin/*` screens**

- Implement `requireAdminUser` in Node.js server actions and handlers, checking the verified Supabase user + `SELECT user_id, email, role FROM admin_users WHERE user_id = $1`, and implement a runtime-compatible session gate in `src/middleware.ts` guarding `/admin/:path*` (except `/admin/login`) and `/api/admin/:path*`.
- Implement `savePatternViewCuration` validating `ConstructionProfileV1Schema`, running `serializeCanonicalRegions` + `TextEmbedder.embedRegions(..., 'RETRIEVAL_DOCUMENT')`, updating `pattern_views` (`human_verified = true`, `verified_by`, `verified_at`), and upserting `pattern_size_bands` + `patterns` inside `withTransaction`.
- Perform the verified-user and allowlist check at every write entry point before using service credentials. Keep pg and storage-service imports out of Edge middleware. Use email/password for the v1 admin login. Load raw source fields and missing measurements from the import item for the editor. Wire per-item retry and same-maker band merge controls. Compare the saved revision during the transaction to prevent a slow embed response from overwriting a newer edit.
- Build `/admin/login`, `/admin/makers` (opt-in permission note + UTM/affiliate + approve/suspend), `/admin/imports` (CSV upload + Shopify URL trigger polling `POST /api/admin/ingestion/process-chunk` (`maxDuration = 60`)), `/admin/patterns` (queue flagging `ai_confidence < 0.80` or missing bust/hip), `/admin/patterns/[id]` (split-view zoomable Technical Flat + Styled Photo vs. structured tag & multi-band size editor + Publish/Unpublish/Takedown), and `/admin/telemetry`.

- [x] **Step 4: Run test to verify it passes**

Run: `bun run test tests/admin/curation-and-auth.test.ts`
Expected: PASS.

- [x] **Step 5: Commit and submit for task review**

```bash
git add src/modules/admin src/middleware.ts src/app/admin src/app/api/admin tests/admin
git commit -m "feat(admin): add Atelier curation cockpit, auth allowlist, automatic Save & Re-Embed sync, and CTR telemetry"
```

---

### Task 10: Offline Benchmark Evaluation Harness & Smoke Release Gate (`bun run eval:benchmark`)

**Files:**
- Create: `src/modules/eval/metrics.ts`
- Create: `eval/fixtures/smoke-v1/manifest.json` and its referenced query images and profile fixtures
- Create: `scripts/eval/run-benchmark.ts`
- Modify: `package.json` (add `"db:seed": "bun scripts/db-seed.ts"` and `"eval:benchmark": "bun scripts/eval/run-benchmark.ts"`)
- Test: `tests/eval/benchmark-harness.test.ts`

**Interfaces:**
- Consumes: `analyzeAndSearch`, `executeSessionSearch` from `@/modules/search/*`; `seedSyntheticCatalog` from `supabase/seed/synthetic-catalog`
- Produces:
  - `BenchmarkCase = { id: string; description: string; imagePath: string; focusRegion: FocusRegion; filters?: SearchFilters; relevantGrades: Record<string, 1 | 2>; printTrapPatternIds?: string[] }`
  - `BenchmarkScorecard = { totalCases: number; top3RelevanceRate: number; printTrapContaminationAt3: number; mrr: number; ndcgAt5: number; byRegion: Record<FocusRegion, { count: number; top3RelevanceRate: number; ndcgAt5: number }>; latencyP50Ms: number; latencyP95Ms: number; gatesPassed: boolean; failedGates: string[] }`
  - `evaluateBenchmarkRun(cases: BenchmarkCase[], runs: Array<{ caseId: string; rankedPatternIds: string[]; latencyMs: number }>): BenchmarkScorecard`

- [ ] **Step 1: Write failing tests for scorecard metrics, release gates (`>=85%` Top-3, `0%` print-trap, `<3500ms` p95), and 15-case smoke run**

Create `tests/eval/benchmark-harness.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateBenchmarkRun } from '@/modules/eval/metrics';
import { runSmokeBenchmarkSuite } from '../../scripts/eval/run-benchmark';

describe('Benchmark scorecard math & 15-query smoke suite', () => {
  it('computes Top-3 relevance, Print-Trap@3, MRR, NDCG@5, and flags gate failures when Top-3 < 0.85 or Print-Trap > 0', () => {
    const card = evaluateBenchmarkRun(
      [
        { id: 'q1', description: 'floral midi', imagePath: 'q1.webp', focusRegion: 'full_silhouette', relevantGrades: { p1: 2 }, printTrapPatternIds: ['trap1'] },
      ],
      [{ caseId: 'q1', rankedPatternIds: ['trap1', 'p1', 'p9'], latencyMs: 1800 }]
    );
    expect(card.top3RelevanceRate).toBe(1.0);
    expect(card.printTrapContaminationAt3).toBe(1.0);
    expect(card.gatesPassed).toBe(false);
    expect(card.failedGates).toContain('PRINT_TRAP_CONTAMINATION_AT_3');
  });

  it('passes all release gates across the 15-query Stage-A smoke benchmark suite', async () => {
    const scorecard = await runSmokeBenchmarkSuite();
    expect(scorecard.totalCases).toBe(15);
    expect(scorecard.top3RelevanceRate).toBeGreaterThanOrEqual(0.85);
    expect(scorecard.printTrapContaminationAt3).toBe(0);
    expect(scorecard.latencyP95Ms).toBeLessThan(3500);
    expect(scorecard.gatesPassed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test tests/eval/benchmark-harness.test.ts`
Expected: FAIL with missing `@/modules/eval/metrics` and `scripts/eval/run-benchmark.ts`.

- [ ] **Step 3: Implement `metrics.ts`, `eval/fixtures/smoke-v1/manifest.json`, and `scripts/eval/run-benchmark.ts`**

- Use stable pattern slugs for the authored smoke manifest. At run startup resolve slugs to the current database IDs (the seed generates UUIDs). Fail on unknown labels, missing query images, an empty suite, missing runs or duplicates. Explicitly record zero hits and failures so a partial run cannot improve the reported score. Supply reproducible original query images and expected extractor outputs for all 15 smoke cases. Their fake extractor maps the fixture input to a profile. Compute all embeddings with the same deterministic function as the Stage A seed, then run the real session, filtering and ranking code.
- Implement `evaluateBenchmarkRun` computing Top-3 hit rate (`any pattern in rankedPatternIds.slice(0, 3) has grade >= 1`), Print-Trap Contamination@3 (`any pattern in slice(0, 3) is in printTrapPatternIds`), reciprocal rank (`1 / (firstHitIdx + 1)`), graded `NDCG@5` using gain `(2^grade - 1) / log2(rank + 1)`, per-`FocusRegion` breakdowns, p50/p95 latency, and release gates (`top3RelevanceRate >= 0.85`, `printTrapContaminationAt3 === 0`, `latencyP95Ms < 3500`).
- Create `eval/fixtures/smoke-v1/manifest.json` with 15 synthetic benchmark queries spanning `full_silhouette` dresses & tops, `bodice_neckline` cross-category matching, `sleeves_armscye`, `skirt_hemline`, Straight vs. Curve measurement filters, and floral/plaid print-trap negative pairs.
- Implement `bun run eval:benchmark --smoke` with a fresh migrated PGlite database and zero network dependencies. Implement `bun run eval:benchmark --dataset eval/benchmark-v1` for the permissioned staging catalog. Use the same live embedding model and dimensions on catalog and query sides. Start cold for each measured upload. Record grade-1/grade-2 relevance, print-trap labels, model IDs, fixture count, and whether timing is offline, server-only or browser end-to-end. Emit Markdown and JSON scorecards and return exit 1 when a required gate fails.
- For Stage B, verify the 15–25 permissioned houses, 300–500 active Dress/Top views and 50–100 human-graded queries from the spec. Require ≥85% Top-3 relevance, exactly zero trap hits in the Top-3, cold upload-to-render p95 <3,500 ms and refinement <100 ms with zero model calls. Measure browser submission through painted results on staging. Use cold queries and separately timed repeated refinements. Keep the 80 ms API refinement target visible alongside the browser measurement. Mark the live release decision pending while the catalog, human labels or timing evidence are missing.

- [ ] **Step 4. Verify the integrated application.** Run `bun run test`, `bun run typecheck`, `bun run build` and `bun run eval:benchmark --smoke`. All four must exit 0. On a fresh migrated PostgreSQL/pgvector staging database, exercise upload → search → matching-band redirect and approved import → curate → publish → takedown using the configured Supabase Auth and Storage. Check that allowlist, RLS, worker retry, media loading and click attribution behave through their real entry points. Record Stage A and Stage B results separately.

- [ ] **Step 5: Commit and submit for task review**

```bash
git add src/modules/eval eval/fixtures scripts/eval package.json tests/eval
git commit -m "feat(eval): add offline benchmark evaluation CLI, metrics scorecard, and 15-query smoke gate"
```
