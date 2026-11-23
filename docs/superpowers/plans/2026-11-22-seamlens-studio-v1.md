# SeamLens Studio (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build SeamLens Studio v1—a construction-aware visual sewing pattern discovery web aggregator, permissioned batch ingestion pipeline, Atelier Admin curation cockpit, and benchmark evaluation harness.

**Architecture:** Single TypeScript Next.js 15 App Router modular monolith backed by PostgreSQL 16 + `pgvector` (Supabase) and Supabase Storage. Uploads and URL images are processed ephemerally in memory into a strict `ConstructionProfileV1` JSON object plus up to four print-stripped regional text embeddings (`768-d`), cached in an `UNLOGGED` Postgres session table (`30 min` TTL) so Part-Focus and sewability filter refinements execute in `<80 ms` with zero extra LLM calls.

**Tech Stack:** Next.js 15 (App Router, Node.js 22 runtime), TypeScript 5.x, Tailwind CSS v4, PostgreSQL 16 + `pgvector` (`pg` in prod, `@electric-sql/pglite` + `vector` extension in automated tests), Supabase Auth & Storage (`@supabase/supabase-js`, `@supabase/ssr`), `@google/genai` (`gemini-2.5-flash` + `gemini-embedding-001`), `zod`, `sharp`, `vitest`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-11-22-seamlens-technical-architecture-design.md`

## Global Constraints

- **Authoritative Visual Basis:** Derive UI tokens and layouts strictly from `PRODUCT_STITCH.md`, *Fold Atelier* (`Screenshot 2026-11-20 at 9.33.59 PM.png`), and *Kripalani Tailors*. **Explicitly disregard `mockups/`**—do not import, copy, or reference any files under `mockups/`.
- **v1 Garment & Route Scope:** Dress and Top views only (`'dress' | 'top'`). Public routes are `/`, `/search`, and `GET /go/[pattern_id]`—do **not** build standalone `/patterns/[slug]` or `/makers/[slug]` pages, consumer user accounts, saved boards/wishlists, or checkout/PDF hosting.
- **Zero Persisted User Uploads:** Raw bytes from user file uploads or direct image URL pastes must never be written to disk, database columns, or Supabase Storage; persist only `image_sha256`, `ConstructionProfileV1` JSONB, canonical strings, and `vector(768)` columns in `UNLOGGED TABLE query_sessions` (`30 min` TTL).
- **Strict Permissioned Supply Gate:** Database triggers and ingestion workers must physically block importing or publishing patterns unless parent `makers.vetted_status = 'approved'`.
- **Curation Vector Sync:** Every Admin edit to `pattern_views.construction_profile` must synchronously re-run `serializeCanonicalRegions` and `TextEmbedder.embedRegions` before committing so `pgvector` columns never drift from human-curated tags.
- **Hard Performance & Cost Ceilings:** Cold visual search target `<3.5s` p95 (`thinkingBudget: 0` on live queries; `1024` on offline ingestion); filter/Part-Focus query target `<100 ms`; IP rate limits `10 req/min` and `40 req/hr` on `/api/v1/search/analyze`, `120 req/min` on `/api/v1/search/query`; configurable daily spend circuit breaker defaulting to `$10.00/day` UTC (`DAILY_AI_BUDGET_USD`).

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
  migrations/202611220001_init_seamlens_v1.sql   # Schema, HNSW/GIN/B-tree indexes, publish trigger, RLS
  seed/synthetic-catalog.ts                      # 22 IP-clean synthetic Dress/Top views, Straight+Curve bands, 4 archetypes
scripts/
  db-seed.ts                                     # Applies migration + seeds local/staging Postgres
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
      gemini-vision-extractor.ts                 # Gemini 2.5 Flash structured JSON extractor (live vs ingest thinking)
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

- [ ] **Step 1: Initialize git, Next.js/Vitest config, and write the failing taxonomy/serializer/measurement tests**

Initialize repository (`git init -b main`), install dependencies (`next@^15`, `react@^19`, `react-dom@^19`, `zod`, `@google/genai`, `pg`, `pgvector`, `sharp`, `@supabase/supabase-js`, `@supabase/ssr`, and devDependencies `typescript`, `tsx`, `vitest`, `@vitejs/plugin-react`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `@electric-sql/pglite`, `@types/pg`, `@types/node`, `tailwindcss`, `@tailwindcss/postcss`), configure `@/* -> ./src/*` path alias in `tsconfig.json` and `vitest.config.ts`, then create `tests/taxonomy/taxonomy-and-serializer.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ConstructionProfileV1Schema, type ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import { sanitizeStructuralNote, serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import { parseMeasurementInches } from '@/modules/taxonomy/measurements';

const sampleDress: ConstructionProfileV1 = {
  schema_version: 1,
  garment_category: 'dress',
  substrate_compatibility: 'woven',
  silhouette: { overall_shape: 'fit_and_flare', ease_level: 'close_fitting', garment_length: 'midi' },
  bodice_and_neckline: {
    neckline_type: 'square',
    neckline_depth: 'modest_mid',
    collar_type: 'none',
    shaping_darts_seams: ['bust_dart', 'waist_dart'],
    waist_definition: 'natural_seam',
    back_detail: 'closed_solid',
  },
  sleeves_and_armscye: {
    armscye_construction: 'set_in',
    sleeve_style: 'puff_gathered_cap',
    sleeve_length: 'elbow',
    cuff_finish: 'elastic_casing',
  },
  skirt_and_hemline: {
    has_skirt_section: true,
    skirt_construction: 'gathered_rectangle',
    tier_count: 1,
    slit_detail: 'none',
    hemline_shape: 'straight_level',
    pockets: ['in_seam'],
  },
  closures_and_details: { primary_closure: 'invisible_zip_back', finish_structure: 'lined_bodice' },
  structural_nuance_notes: {
    bodice_neckline: 'Liberty-floral square bodice with bias-cut facing and collar-stand absence',
    sleeves_armscye: 'GINGHAM-check gathered cap with 2x fullness',
    skirt_hemline: 'Navy/ivory Breton-stripe box-pleat look at side in-seam pockets',
    overall_drape_and_proportions: 'Crisp cotton wash in crimson red with structured waist join',
  },
};

describe('ConstructionProfileV1 & print-blind serialization', () => {
  it('validates canonical dress profile and rejects unknown enum values', () => {
    expect(ConstructionProfileV1Schema.safeParse(sampleDress).success).toBe(true);
    expect(
      ConstructionProfileV1Schema.safeParse({ ...sampleDress, garment_category: 'trousers' }).success
    ).toBe(false);
  });

  it('scrubs compound/uppercase print & color words while preserving sewing terms (Review Focus #2)', () => {
    const cleaned = sanitizeStructuralNote(
      'Liberty-floral GINGHAM-check navy/ivory Breton-stripe crimson bias-cut box-pleat collar-stand'
    );
    expect(cleaned.toLowerCase()).not.toMatch(/floral|gingham|navy|ivory|stripe|crimson/);
    expect(cleaned).toContain('bias-cut');
    expect(cleaned).toContain('box-pleat');
    expect(cleaned).toContain('collar-stand');
  });

  it('emits 4 region strings for dresses and null skirt_hemline when has_skirt_section is false', () => {
    const dressTexts = serializeCanonicalRegions(sampleDress);
    expect(dressTexts.skirt_hemline).toContain('gathered_rectangle');
    expect(dressTexts.full_silhouette.toLowerCase()).not.toMatch(/floral|gingham|crimson/);

    const topProfile: ConstructionProfileV1 = {
      ...sampleDress,
      garment_category: 'top',
      skirt_and_hemline: { ...sampleDress.skirt_and_hemline, has_skirt_section: false, skirt_construction: 'none_top_hem', tier_count: 0 },
    };
    expect(serializeCanonicalRegions(topProfile).skirt_hemline).toBeNull();
  });

  it('parses decimal inches, unicode/slash fractions, and converts cm to inches (Review Focus #3)', () => {
    expect(parseMeasurementInches('44')).toBe(44);
    expect(parseMeasurementInches('33½"')).toBe(33.5);
    expect(parseMeasurementInches('34 1/4 in')).toBe(34.3);
    expect(parseMeasurementInches('101.6 cm')).toBe(40.0);
    expect(parseMeasurementInches(112, 'cm')).toBe(44.1);
    expect(parseMeasurementInches('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/taxonomy/taxonomy-and-serializer.test.ts`
Expected: FAIL with module resolution errors for `@/modules/taxonomy/*`.

- [ ] **Step 3: Implement `construction-profile.ts`, `canonical-serializer.ts`, and `measurements.ts`**

- In `src/modules/taxonomy/construction-profile.ts`, define every enum and `ConstructionProfileV1Schema` matching Spec §5.2 (`schema_version: z.literal(1)`, `structural_nuance_notes` fields capped at `300` chars).
- In `src/modules/taxonomy/canonical-serializer.ts`, implement `sanitizeStructuralNote(raw)` splitting hyphen/slash compounds only on surface-print/color/wash denylist stems (`floral`, `gingham`, `plaid`, `tartan`, `polka`, `stripe`, `striped`, `breton`, `paisley`, `leopard`, `houndstooth`, `check`, `checked`, `crimson`, `red`, `blue`, `navy`, `ivory`, `emerald`, `sage`, `terracotta`, `pink`, `yellow`, `purple`, `black`, `white`, `beige`, `liberty`, `acid-wash`, `bleach`) while leaving structural hyphenates (`bias-cut`, `box-pleat`, `collar-stand`, `set-in`, `a-line`, `in-seam`, `high-low`) intact; implement `serializeCanonicalRegions(profile)` returning deterministic labeled prose for the 4 regions (`skirt_hemline: null` when `!profile.skirt_and_hemline.has_skirt_section`).
- In `src/modules/taxonomy/measurements.ts`, normalize vulgar fractions (`½ -> .5`, `¼ -> .25`, `¾ -> .75`) and `N M/D` slash fractions, detect `'cm'` suffix or `unitHint === 'cm'`, divide by `2.54`, and round to 1 decimal place (`Math.round(val * 10) / 10`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/taxonomy/taxonomy-and-serializer.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json next.config.ts vitest.config.ts src/modules/taxonomy tests/taxonomy
git commit -m "feat(taxonomy): add ConstructionProfileV1 schema, print-blind serializer, and measurement parser"
```

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

- [ ] **Step 1: Write the failing scoring and chip generation tests**

Create `tests/taxonomy/scoring-and-chips.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeStructuralScore, combineHybridScore } from '@/modules/taxonomy/scoring';
import { buildExplanationChips } from '@/modules/taxonomy/chips';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';

// Construct baseDress (square neck, elbow puff_gathered_cap sleeve, gathered_rectangle midi skirt, woven)
// and variantSleevelessScoop (scoop neck, none_sleeveless, identical gathered_rectangle midi skirt, woven)
describe('Deterministic regional structural scoring & chips', () => {
  it('scores identical profiles as 1.0 across all focus regions and combines with alpha=0.55', () => {
    expect(computeStructuralScore(baseDress, baseDress, 'full_silhouette')).toBeCloseTo(1.0, 5);
    expect(computeStructuralScore(baseDress, baseDress, 'bodice_neckline')).toBeCloseTo(1.0, 5);
    expect(combineHybridScore(0.9, 0.8)).toBeCloseTo(0.55 * 0.9 + 0.45 * 0.8, 5);
  });

  it('weights skirt_hemline at 0.85+0.15 so matching skirt scores >0.90 under skirt_hemline despite sleeve/neck mismatch', () => {
    const skirtFocusScore = computeStructuralScore(baseDress, variantSleevelessScoop, 'skirt_hemline');
    const sleeveFocusScore = computeStructuralScore(baseDress, variantSleevelessScoop, 'sleeves_armscye');
    expect(skirtFocusScore).toBeGreaterThan(0.9);
    expect(sleeveFocusScore).toBeLessThan(0.25);
  });

  it('redistributes the 0.20 skirt weight proportionally when query garment_category is top under full_silhouette', () => {
    expect(computeStructuralScore(baseTop, baseTop, 'full_silhouette')).toBeCloseTo(1.0, 5);
  });

  it('emits up to 4 Matched chips and up to 2 Diff/Minor Hack chips when totalScore >= 0.62', () => {
    const { matched, diffs } = buildExplanationChips(baseDress, variantSleevelessScoop, 'full_silhouette', 0.74);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThanOrEqual(4);
    expect(diffs.length).toBe(2);
    expect(diffs.map((d) => d.slot)).toEqual(expect.arrayContaining(['neckline_type', 'sleeve_style']));

    const lowScoreChips = buildExplanationChips(baseDress, variantSleevelessScoop, 'full_silhouette', 0.5);
    expect(lowScoreChips.diffs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/taxonomy/scoring-and-chips.test.ts`
Expected: FAIL with missing `@/modules/taxonomy/scoring` and `@/modules/taxonomy/chips`.

- [ ] **Step 3: Implement `scoring.ts` and `chips.ts` with exact Spec §5.4.3 weights**

- In `src/modules/taxonomy/scoring.ts`: implement exact slot weights from Spec §5.4.3 (`full_silhouette`: `overall_shape` `0.20`, `bodice_and_neckline` `0.30` [`neckline_type` `0.14`, darts Jaccard `0.10`, `waist_definition` `0.06`], `sleeves_and_armscye` `0.20` [`sleeve_style` `0.10`, `armscye_construction` `0.05`, `sleeve_length` `0.05`], `skirt_and_hemline` `0.20` [`skirt_construction` `0.12`, `tier_count` `0.04`, `garment_length` `0.04`] redistributed across the `0.80` non-skirt weights via `/ 0.80` when `query.garment_category === 'top'`, `substrate + closure` `0.10`; plus the `0.85 / 0.15` regional weights for `bodice_neckline`, `sleeves_armscye`, and `skirt_hemline`; treat `'both'` substrate as compatible `1.0` with `'woven'` or `'knit'`).
- In `src/modules/taxonomy/chips.ts`: map enum values to human-readable couture labels (e.g. `'Modest Mid Square Neckline'`, `'Bust + Waist Darts'`, `'Elbow Puff Sleeve'`, `'Diff: Sleeveless block (add sleeve)'`), prioritizing active-region slots first, returning max `4` `matched` chips and max `2` `diffs` chips only when `totalScore >= 0.62`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/taxonomy/scoring-and-chips.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/taxonomy/scoring.ts src/modules/taxonomy/chips.ts tests/taxonomy/scoring-and-chips.test.ts
git commit -m "feat(taxonomy): add region-weighted structural scorer and deterministic Match/Diff chip builder"
```

---

### Task 3: PostgreSQL + `pgvector` Schema, Publish Trigger, RLS & Stage-A Synthetic Seed Catalog

**Files:**
- Create: `supabase/migrations/202611220001_init_seamlens_v1.sql`
- Create: `src/lib/env.ts`
- Create: `src/lib/db.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `supabase/seed/synthetic-catalog.ts`
- Create: `scripts/db-seed.ts`
- Test: `tests/db/schema-and-seed.test.ts`

**Interfaces:**
- Consumes: `ConstructionProfileV1`, `serializeCanonicalRegions` from `@/modules/taxonomy/*`
- Produces:
  - `Queryable = { query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }> }`
  - `getDbPool(): Queryable`, `withTransaction<T>(db: Queryable, fn: (tx: Queryable) => Promise<T>): Promise<T>`
  - `toVectorLiteral(vec: number[] | null): string | null` (formats `[0.1,0.2,...]` and validates `vec.length === 768`)
  - `seedSyntheticCatalog(db: Queryable): Promise<{ makerCount: number; patternCount: number; viewCount: number; archetypeCount: number }>`

- [ ] **Step 1: Write the failing database migration, trigger, and seed tests using `PGlite` + `vector`**

Create `tests/db/schema-and-seed.test.ts` booting `@electric-sql/pglite` with `{ extensions: { vector } }` and executing `supabase/migrations/202611220001_init_seamlens_v1.sql`:

```typescript
import { describe, expect, it, beforeAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import fs from 'node:fs';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';

describe('PostgreSQL + pgvector schema, publish guardrails, and synthetic seed', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    await pg.exec(fs.readFileSync('supabase/migrations/202611220001_init_seamlens_v1.sql', 'utf8'));
  });

  it('seeds >=20 synthetic Dress/Top views, Straight+Curve split bands, nullable-hip cropped top, and >=4 archetypes', async () => {
    const counts = await seedSyntheticCatalog(pg);
    expect(counts.viewCount).toBeGreaterThanOrEqual(20);
    expect(counts.archetypeCount).toBeGreaterThanOrEqual(4);
  });

  it('blocks publishing when maker is pending, dress lacks hip bounds, or pattern has no views', async () => {
    // 1. Maker vetted_status = 'pending' -> UPDATE patterns SET status = 'published' throws
    // 2. Dress with hip_min_in = NULL in pattern_size_bands -> throws
    // 3. Cropped Top (garment_category = 'top') with hip_min_in = NULL and valid bust bounds -> SUCCEEDS
    await expect(
      pg.query(`UPDATE patterns SET status = 'published' WHERE slug = 'unapproved-maker-test-dress'`)
    ).rejects.toThrow(/maker.*approved/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/schema-and-seed.test.ts`
Expected: FAIL with missing migration file and seed module.

- [ ] **Step 3: Author SQL migration, `src/lib/db.ts`, `src/lib/supabase/server.ts`, and `supabase/seed/synthetic-catalog.ts`**

- Create `supabase/migrations/202611220001_init_seamlens_v1.sql` with all tables from Spec §5.3 (`makers`, `patterns`, `pattern_size_bands`, `pattern_views`, `curated_archetypes`, `UNLOGGED query_sessions`, `ingestion_batches`, `ingestion_items`, `search_events`, `outbound_clicks`, `api_usage_ledger`, `admin_users`) plus `rate_limit_windows (bucket TEXT, subject_hash TEXT, window_start TIMESTAMPTZ, hit_count INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (bucket, subject_hash, window_start))`, HNSW (`m = 16, ef_construction = 64`) + GIN + B-tree indexes, `enforce_pattern_publish_readiness()` PL/pgSQL trigger, and RLS policies (`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN ... END IF; END $$;` so local non-Supabase Postgres / `PGlite` runs cleanly while Supabase enforces `anon` / `authenticated` RLS).
- Implement `src/lib/env.ts`, `src/lib/db.ts` (`Queryable`, `getDbPool`, `withTransaction`, `toVectorLiteral`), and `src/lib/supabase/server.ts`.
- Implement `supabase/seed/synthetic-catalog.ts` + `scripts/db-seed.ts` seeding 6 fictional approved makers, 18 published patterns / 22 views (including Straight `32"–46"` + Curve `44"–62"` multi-band dress, cropped blouse with `hip_min_in = null`, floral t-shirt vs. floral square-neck midi dress print-trap decoys, and deterministic L2-normalized 768-d hash-seeded vectors derived from canonical tokens so cosine similarity aligns with construction traits in offline tests) plus 4 `curated_archetypes`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/schema-and-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase src/lib scripts/db-seed.ts tests/db
git commit -m "feat(db): add Postgres/pgvector schema, publish readiness trigger, RLS, and synthetic seed catalog"
```

---

### Task 4: Multimodal Vision Extractor, Batched 768-d Text Embedder & Daily Spend Circuit Breaker

**Files:**
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
  - `assertDailyBudgetAvailable(db: Queryable, dailyCapUsd?: number): Promise<void>` (throws `BudgetExceededError` with `statusCode = 503` when UTC day sum `>= dailyCapUsd`)
  - `recordApiUsage(db: Queryable, delta: { operation: 'search_vision' | 'search_embed' | 'ingest_vision' | 'ingest_embed'; inputTokens: number; outputTokens: number; estimatedCostUsd: number }): Promise<void>`

- [ ] **Step 1: Write failing tests for Gemini adapter configs, vector normalization, and `$10/day` circuit breaker**

Create `tests/vision/vision-and-budget.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createGeminiVisionExtractor } from '@/modules/vision/gemini-vision-extractor';
import { createGeminiTextEmbedder, l2Normalize } from '@/modules/vision/gemini-text-embedder';
import { assertDailyBudgetAvailable, recordApiUsage, BudgetExceededError } from '@/modules/vision/usage-ledger';

describe('VisionExtractor, TextEmbedder, and Daily Spend Circuit Breaker', () => {
  it('passes thinkingBudget=0 for live_query and thinkingBudget=1024 for catalog_ingestion', async () => {
    const calls: unknown[] = [];
    const fakeClient = { models: { generateContent: async (req: unknown) => { calls.push(req); return mockGeminiJsonResp; } } };
    const extractor = createGeminiVisionExtractor(fakeClient as never);
    await extractor.extract({ images: [{ mimeType: 'image/webp', bytes: Buffer.from('x') }], mode: 'live_query' });
    await extractor.extract({ images: [{ mimeType: 'image/webp', bytes: Buffer.from('x') }], mode: 'catalog_ingestion' });
    expect((calls[0] as any).config.thinkingConfig.thinkingBudget).toBe(0);
    expect((calls[1] as any).config.thinkingConfig.thinkingBudget).toBe(1024);
  });

  it('batches only non-null regions into one 768-d embedContent call and L2-normalizes vectors', async () => {
    const vec = l2Normalize(Array.from({ length: 768 }, (_, i) => (i === 0 ? 3 : i === 1 ? 4 : 0)));
    expect(Math.hypot(...vec)).toBeCloseTo(1.0, 6);
    // Verify top profile with skirt_hemline: null sends 3 contents and returns vectors.skirt === null
  });

  it('trips BudgetExceededError once UTC daily spend reaches DAILY_AI_BUDGET_USD ($10.00)', async () => {
    await recordApiUsage(pg, { operation: 'search_vision', inputTokens: 100_000, outputTokens: 20_000, estimatedCostUsd: 10.0 });
    await expect(assertDailyBudgetAvailable(pg, 10.0)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vision/vision-and-budget.test.ts`
Expected: FAIL with missing `@/modules/vision/*` modules.

- [ ] **Step 3: Implement `types.ts`, `gemini-vision-extractor.ts`, `gemini-text-embedder.ts`, and `usage-ledger.ts`**

- In `gemini-vision-extractor.ts`: call `gemini-2.5-flash` with `responseMimeType: 'application/json'`, strict `responseSchema` wrapping `{ status, ai_confidence, warnings, profile }`, and a system prompt instructing technical-flat priority (when `role === 'flat_front' | 'flat_back'`), foreground-garment targeting (`warnings: ['multiple_garments_detected']` when multiple people appear), `'unsupported_category_v1'` on trousers/menswear/outerwear, and strict ban on fabric print/color words in `structural_nuance_notes`. Validate `profile` with `ConstructionProfileV1Schema`.
- In `gemini-text-embedder.ts`: batch all non-null strings from `CanonicalRegionTexts` in one `models.embedContent` request (`model: 'gemini-embedding-001'`, `config: { outputDimensionality: 768, taskType }`) and L2-normalize each `768`-float vector.
- In `usage-ledger.ts`: atomic `INSERT INTO api_usage_ledger ... ON CONFLICT (usage_date, operation) DO UPDATE` + `SUM(estimated_cost_usd) WHERE usage_date = (now() AT TIME ZONE 'UTC')::DATE`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vision/vision-and-budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/vision tests/vision
git commit -m "feat(vision): add Gemini 2.5 Flash extractor, batched 768-d embedder, and daily spend circuit breaker"
```

---

### Task 5: Image Input Hardening (EXIF/Magic Bytes & SSRF), Rate Limiter & Hybrid Search Engine

**Files:**
- Create: `src/modules/search/image-ingest.ts`
- Create: `src/modules/search/rate-limit.ts`
- Create: `src/modules/search/hybrid-ranker.ts`
- Create: `src/modules/search/analyze-service.ts`
- Test: `tests/search/image-security-and-ranker.test.ts`

**Interfaces:**
- Consumes: `@/modules/taxonomy/*`, `@/modules/vision/*`, `@/lib/db`
- Produces:
  - `SearchError` (`code: 'UNSUPPORTED_IMAGE_FORMAT' | 'SSRF_BLOCKED' | 'HTML_PAGE_URL_UNSUPPORTED' | 'NO_GARMENT_DETECTED' | 'SESSION_EXPIRED' | 'RATE_LIMITED'`, `statusCode: number`)
  - `validateAndNormalizeServerImage(raw: Buffer, cropBox?: CropBox | null): Promise<{ webpBytes: Buffer; sha256: string; width: number; height: number }>`
  - `fetchDirectImageUrlSafe(rawUrl: string, deps?: { lookup?: DnsLookupFn; fetchImpl?: typeof fetch }): Promise<Buffer>`
  - `enforceRateLimit(db: Queryable, ipHash: string, bucket: 'analyze_min' | 'analyze_hr' | 'query_min', limit: number, windowSec: number): Promise<{ allowed: boolean; retryAfterSec: number }>`
  - `SearchFilters = { substrate?: 'woven' | 'knit' | null; userBustIn?: number | null; userHipIn?: number | null; formats?: DeliveryFormat[]; skills?: SkillLevel[] }`
  - `RankedPatternCard = { patternId: string; viewId: string; viewLabel: string; secondaryViewCount: number; garmentCategory: GarmentCategory; title: string; makerName: string; coverImageUrl: string; flatFrontImageUrl: string | null; flatBackImageUrl: string | null; matchedSizeBandId: string; priceCents: number | null; currency: string; bustRangeIn: [number, number]; hipRangeIn: [number | null, number | null]; designerSizeLabel: string; substrateType: SubstrateCompatibility; formats: DeliveryFormat[]; skillLevel: SkillLevel; totalScore: number; matchedChips: MatchChip[]; diffChips: MatchChip[] }`
  - `CandidateReranker = { rerank(query: ConstructionProfileV1, focusRegion: FocusRegion, candidates: RankedPatternCard[]): Promise<RankedPatternCard[]> }` (default `noopCandidateReranker` returning `candidates` unchanged—pluggable Stage-2 flat reranker seam per Spec §4)
  - `executeSessionSearch(db: Queryable, querySessionId: string, focusRegion: FocusRegion, filters: SearchFilters, reranker?: CandidateReranker): Promise<{ querySessionId: string; queryStatus: string; extractedProfile: ConstructionProfileV1; warnings: string[]; results: RankedPatternCard[]; relaxationHints: string[] }>`
  - `analyzeAndSearch(deps: AnalyzeDeps, input: AnalyzeInput): Promise<SearchExecutionResult>`

- [ ] **Step 1: Write failing tests for EXIF/HEIC rejection, SSRF redirect blocking, rate limits, and hybrid ranking**

Create `tests/search/image-security-and-ranker.test.ts` covering:
1. **Review Focus #1:** Rotate-tagged EXIF JPEG (`Orientation = 6`, `800x1200` stored sideways as `1200x800`) normalizes to upright `width < height` WebP with EXIF stripped; fake HEIC (`ftypheic` header) and 0-byte buffers throw `SearchError('UNSUPPORTED_IMAGE_FORMAT', 415)`.
2. **Review Focus #4:** `fetchDirectImageUrlSafe` accepts `https://cdn.example.com/look.jpg?w=1080` resolving to `93.184.216.34`, blocks `http://...`, blocks `169.254.169.254` / `127.0.0.1` / `10.0.0.1` / `::1`, blocks an `https://public.example/img` that returns `302 Location: https://internal.example/meta` resolving to `169.254.169.254`, and throws `HTML_PAGE_URL_UNSUPPORTED` (`422`) when `Content-Type: text/html` is returned (e.g. Instagram post URL).
3. **Hybrid SQL + `pgvector` Ranker:** Against the seeded `PGlite` database:
   - `full_silhouette` floral square-neck puff midi query ranks the woven square-neck midi dress #1 and keeps the floral t-shirt decoy out of Top-3.
   - Switching `focusRegion` to `'bodice_neckline'` includes matching `'top'` blocks alongside `'dress'` views.
   - Setting `userBustIn: 52, userHipIn: 56` matches the Curve band (`44"–62"`), sets `matchedSizeBandId` to the Curve `pattern_size_bands.id`, and still lets the nullable-hip cropped top pass under `bodice_neckline`.
   - Deduplicates multi-view patterns by `pattern_id` (`secondaryViewCount >= 1`) and emits `relaxationHints` when strict `formats: ['projector']` + `skills: ['advanced_couture']` yields 0 matches.
   - Repeating `analyzeAndSearch` with identical image bytes hits `query_sessions` by `image_sha256` with `0` additional `VisionExtractor` calls.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/search/image-security-and-ranker.test.ts`
Expected: FAIL with missing `@/modules/search/*` modules.

- [ ] **Step 3: Implement `image-ingest.ts`, `rate-limit.ts`, `hybrid-ranker.ts`, and `analyze-service.ts`**

- In `image-ingest.ts`: verify magic bytes (`FF D8 FF` JPEG, `89 50 4E 47` PNG, `RIFF....WEBP` WebP, `....ftypavif` AVIF; explicitly reject `ftypheic`/`ftypheix` and anything else with `415`), apply optional normalized `cropBox` after `sharp(raw).rotate()` (so crop coordinates align with upright display!), resize `fit: 'inside', width: 1280, height: 1280, withoutEnlargement: true`, output `.webp({ quality: 82 })`, compute `sha256`. In `fetchDirectImageUrlSafe`, use `redirect: 'manual'`, validate URL + DNS lookup against private IPv4/IPv6 CIDR ranges on hop 0 and at most 1 redirect hop, stream up to `8 * 1024 * 1024` bytes with `AbortSignal.timeout(3000)`.
- In `hybrid-ranker.ts`: inside a transaction, `SET LOCAL hnsw.iterative_scan = relaxed_order;`, fetch `query_sessions` row (`expires_at > now()`, else throw `404 SESSION_EXPIRED`), query top 40 `pattern_views` joined to `patterns`, `makers`, and matching `pattern_size_bands` (`EXISTS` predicate from Spec §5.4.3), compute `combineHybridScore(vecSim, computeStructuralScore(...))`, collapse by `pattern_id`, select best matching `pattern_size_bands` row for `userBustIn`/`userHipIn` (falling back to `is_default = true`), attach `buildExplanationChips`, and run single-facet relaxation counts when `results.length === 0`.
- In `analyze-service.ts`: check rate limit + daily budget, check `query_sessions` cache by `(image_sha256, crop_box)`, run `VisionExtractor` (`mode: 'live_query'`) + `serializeCanonicalRegions` + `TextEmbedder` (`RETRIEVAL_QUERY`), insert `query_sessions` + `search_events`, probabilistically `DELETE FROM query_sessions WHERE expires_at < now()`, and return `executeSessionSearch(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/search/image-security-and-ranker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search tests/search
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
  - `listActiveArchetypes(db: Queryable): Promise<CuratedArchetypeSummary[]>`
  - `createSessionFromArchetype(db: Queryable, slug: string): Promise<string>` (inserts `query_sessions` from `curated_archetypes`, zero LLM calls)
  - `POST /api/v1/search/analyze` (`multipart/form-data` `file` + optional `focusRegion`/`cropBox`/`filters`, OR JSON `{ imageUrl | archetypeSlug, focusRegion, filters }`)
  - `POST /api/v1/search/query` (JSON `{ querySessionId, focusRegion, filters }`)
  - `GET /go/[pattern_id]?band=&q=&v=&pos=&region=` (`302` redirect + async `outbound_clicks` insert)
  - `preprocessGarmentFileInBrowser(file: File, cropBox?: CropBox | null): Promise<{ blob: Blob; previewDataUrl: string }>`

- [ ] **Step 1: Write failing tests for URL merging, archetype instant search, API routes, and `/go/[pattern_id]`**

Create `tests/api/public-routes-and-redirect.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildTrackedDestinationUrl } from '@/modules/catalog/outbound-url';

describe('Outbound URL builder & public API routes', () => {
  it('preserves existing query params and #hash fragments when merging UTM and affiliate params (Review Focus #5)', () => {
    const out = buildTrackedDestinationUrl(
      'https://atelier.example/products/solene?variant=991#size-chart',
      'seamlens_v1',
      'ref=seamlens&partner=pilot'
    );
    const parsed = new URL(out);
    expect(parsed.searchParams.get('variant')).toBe('991');
    expect(parsed.searchParams.get('utm_source')).toBe('seamlens');
    expect(parsed.searchParams.get('utm_medium')).toBe('visual_search');
    expect(parsed.searchParams.get('utm_campaign')).toBe('seamlens_v1');
    expect(parsed.searchParams.get('ref')).toBe('seamlens');
    expect(parsed.hash).toBe('#size-chart');
  });

  it('POST /api/v1/search/analyze with archetypeSlug creates session with 0 Vision calls and <80ms /query follow-up', async () => {
    // Assert 200 response with querySessionId + ranked results; follow-up /api/v1/search/query switches focusRegion
  });

  it('GET /go/[pattern_id]?band=<curveBandId> returns 302 to Curve URL, records outbound_clicks, and returns 404 on unpublished/takedown pattern', async () => {
    // Assert 302 Location header points to curve product_url with UTM tags; takedown pattern returns 404
  });

  it('rejects browser HEIC files cleanly in client preflight before network upload (Review Focus #1)', async () => {
    // Assert File with type 'image/heic' or '.heic' extension throws user-friendly client validation error
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/public-routes-and-redirect.test.ts`
Expected: FAIL with missing route/catalog files.

- [ ] **Step 3: Implement `outbound-url.ts`, `archetypes-repo.ts`, Route Handlers, and `client-canvas-preprocess.ts`**

- Implement `buildTrackedDestinationUrl` using `new URL(productUrl)` and `URLSearchParams(affiliateQueryParam)` so existing query strings and `#hash` fragments never break.
- Implement `POST /api/v1/search/analyze` (`export const runtime = 'nodejs'; export const maxDuration = 30;`) enforcing `10/min` and `40/hr` IP rate limits on live Vision requests (exempting `archetypeSlug` from Vision rate/budget gates, using the `120/min` query bucket instead), and `POST /api/v1/search/query` enforcing `120/min`.
- Implement `GET /go/[pattern_id]/route.ts` (`status = 'published'` AND `vetted_status = 'approved'`), resolving `?band=` against `pattern_size_bands` (`pattern_id = $1`, fallback `is_default = true`), scheduling `INSERT INTO outbound_clicks` via `after()` from `next/server` (with inline `await` fallback in unit-test environment), and returning `NextResponse.redirect(destinationUrl, 302)`.
- Implement `preprocessGarmentFileInBrowser` rejecting `.heic`/`.heif` with a clear prompt to upload JPEG/PNG/WebP/screenshot, drawing via `createImageBitmap` (`imageOrientation: 'from-image'`) onto `<canvas>` (`<=1280px`), and exporting `image/webp` at `0.82`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/public-routes-and-redirect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/catalog src/modules/search/client-canvas-preprocess.ts src/app/api/v1 src/app/go tests/api
git commit -m "feat(api): add search analyze/query endpoints, tracked /go redirect, and client canvas preprocessor"
```

---

### Task 7: Permissioned Batch Catalog Ingestion Pipeline (Shopify JSON & Canonical CSV)

**Files:**
- Create: `src/modules/ingestion/parsers.ts`
- Create: `src/modules/ingestion/media-pipeline.ts`
- Create: `src/modules/ingestion/chunk-worker.ts`
- Test: `tests/ingestion/parsers-and-worker.test.ts`

**Interfaces:**
- Consumes: `parseMeasurementInches`, `ConstructionProfileV1`, `serializeCanonicalRegions` from `@/modules/taxonomy/*`; `VisionExtractor`, `TextEmbedder`, `recordApiUsage` from `@/modules/vision/*`; `Queryable` from `@/lib/db`
- Produces:
  - `RawSizeBandCandidate = { externalProductId: string | null; bandLabel: string; isDefault: boolean; productUrl: string; priceCents: number | null; currency: string; designerSizeLabel: string | null; bustMinIn: number | null; bustMaxIn: number | null; hipMinIn: number | null; hipMaxIn: number | null }`
  - `NormalizedImportDraft = { groupKey: string; title: string; garmentCategoryHint?: 'dress' | 'top' | 'dress_and_top_set'; substrateHint?: SubstrateCompatibility; formatsHint: DeliveryFormat[]; skillHint?: SkillLevel; descriptionHtml: string; imageUrls: Array<{ url: string; roleHint?: 'cover' | 'flat_front' | 'flat_back' }>; sizeBands: RawSizeBandCandidate[]; explicitViews?: Array<{ viewCode: string; viewLabel: string }> }`
  - `parseShopifyProductsJson(json: unknown, storefrontBaseUrl: string): NormalizedImportDraft[]`
  - `parseSeamLensCsv(csvText: string): NormalizedImportDraft[]`
  - `enqueueIngestionBatch(db: Queryable, params: { makerId: string; sourceType: 'shopify_json' | 'csv_upload'; sourceDescriptor: string; drafts: NormalizedImportDraft[]; createdBy: string }): Promise<{ batchId: string; itemCount: number }>`
  - `processNextIngestionChunk(deps: IngestionWorkerDeps, batchId: string, chunkSize?: number): Promise<{ processed: number; completed: number; failed: number; status: string }>`

- [ ] **Step 1: Write failing tests for Straight/Curve Shopify grouping, metric CSV parsing, permission gate, and idempotent chunk execution**

Create `tests/ingestion/parsers-and-worker.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseShopifyProductsJson, parseSeamLensCsv } from '@/modules/ingestion/parsers';
import { enqueueIngestionBatch, processNextIngestionChunk } from '@/modules/ingestion/chunk-worker';

describe('Permissioned Shopify/CSV ingestion & chunked worker', () => {
  it('groups sibling Shopify Straight ("Solène Dress (Sizes 0-20)") and Curve ("Solène Dress - Curve 14-34") products into 1 NormalizedImportDraft with 2 sizeBands', () => {
    const drafts = parseShopifyProductsJson(mockShopifySplitProducts, 'https://verveine.example');
    expect(drafts).toHaveLength(1);
    expect(drafts[0].sizeBands).toHaveLength(2);
    expect(drafts[0].sizeBands.map((b) => b.bandLabel)).toEqual(['Straight', 'Curve']);
  });

  it('converts metric cm ("84 cm", "137 cm") and fractional inches ("33½\\"") in CSV rows into canonical decimal inches (Review Focus #3)', () => {
    const drafts = parseSeamLensCsv(sampleMetricAndFractionCsv);
    expect(drafts[0].sizeBands[0].bustMinIn).toBe(33.1);
    expect(drafts[0].sizeBands[0].hipMaxIn).toBe(53.9);
  });

  it('refuses to enqueue or process batches for unapproved makers and upserts drafts idempotently on re-import', async () => {
    await expect(enqueueIngestionBatch(pg, { makerId: pendingMakerId, sourceType: 'csv_upload', sourceDescriptor: 'test.csv', drafts: [], createdBy: adminId }))
      .rejects.toThrow(/approved/i);
    // Run processNextIngestionChunk twice on same external_product_id -> asserts 1 pattern row (status = 'draft', human_verified = false), no duplicate pattern_size_bands
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/parsers-and-worker.test.ts`
Expected: FAIL with missing `@/modules/ingestion/*` modules.

- [ ] **Step 3: Implement `parsers.ts`, `media-pipeline.ts`, and `chunk-worker.ts`**

- In `parsers.ts`: normalize Shopify titles by stripping trailing Curve/Plus/Extended/Straight size-range suffixes (`/\s*[-–(]*(curve|plus|extended|straight|sizes?\s*\d+[\s–-]+\d+).*$/i`) to form `groupKey`, merging sibling Straight & Curve products into one `NormalizedImportDraft` with distinct `RawSizeBandCandidate` entries; parse CSV rows supporting multi-view (`view_code`) and multi-band (`band_label`) grouping, applying `parseMeasurementInches` (detecting `cm` headers/values automatically).
- In `media-pipeline.ts`: resize approved cover & flat images via `sharp` into `800px` (`-card.webp`) and `1600px` (`-full.webp`) uploaded to `catalog-media/{maker_slug}/{pattern_slug}/...`.
- In `chunk-worker.ts`: verify `makers.vetted_status === 'approved'` before both enqueue and chunk execution; claim up to `chunkSize = 3` `'queued'` items (`FOR UPDATE SKIP LOCKED`), run `VisionExtractor` (`mode: 'catalog_ingestion'`, passing technical flats first), serialize & embed all 4 regions, upsert `patterns (status = 'draft')`, `pattern_size_bands` (`ON CONFLICT (maker_id, external_product_id) DO UPDATE`), and `pattern_views (human_verified = false)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/parsers-and-worker.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ingestion tests/ingestion
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

- [ ] **Step 1: Write failing component interaction tests for Upload Dock, Part-Focus, Filter Sliders, Flat Toggle & Session Recovery**

Create `tests/ui/discovery-flow.test.tsx` (`// @vitest-environment jsdom`):

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PatternMatchCard } from '@/components/pattern-match-card';
import { SewistFilterBar } from '@/components/sewist-filter-bar';
import { DiscoveryWorkspace } from '@/components/discovery-workspace';

describe('Tactile Atelier public discovery UI', () => {
  it('toggles Cover Photo <-> Technical Flat (and Front/Back flat switch when flatBackImageUrl exists), hiding toggle when flatFrontImageUrl is null', () => {
    // Render card with flatFrontImageUrl + flatBackImageUrl -> click "Technical Flat" -> shows Front flat + "Back Flat" switch -> click "Back Flat" -> swaps src
    // Render card with flatFrontImageUrl: null -> queryByRole('button', { name: /technical flat/i }) is null
    // Verify CTA href points directly to `/go/${patternId}?band=${matchedSizeBandId}&...` (no /patterns/[slug] link)
  });

  it('sends single-value userBustIn / userHipIn on slider change and resets to null on "Any"', () => {
    const onChange = vi.fn();
    render(<SewistFilterBar filters={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/my full bust/i), { target: { value: '46' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ userBustIn: 46 }));
  });

  it('switches Part-Focus pills via /api/v1/search/query and transparently re-submits cached blob to /analyze on 404 SESSION_EXPIRED', async () => {
    // Mock /api/v1/search/query returning 404 { code: 'SESSION_EXPIRED' } once, then /api/v1/search/analyze returning fresh querySessionId -> UI updates seamlessly
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ui/discovery-flow.test.tsx`
Expected: FAIL with missing components.

- [ ] **Step 3: Implement Tactile Atelier styling and public discovery components (zero `mockups/` imports)**

- In `src/app/globals.css` & `src/app/layout.tsx`: define clean Atelier CSS custom properties inspired by *Fold Atelier* and *Kripalani Tailors* (woven raw-linen ground `#E5E2DC`, warm drafting-paper card surface `#FAF8F4`, charcoal ink `#1D1E1C`, tailor's chalk & terracotta basting accents `#B84A32`, generous whitespace, `Fraunces` / `Instrument Serif` display + `Plus Jakarta Sans` body + `JetBrains Mono` measurement tags).
- Implement `UploadDock` (drag-drop, mobile camera `accept="image/jpeg,image/png,image/webp,image/avif"`, URL input surfacing friendly screenshot hint on `HTML_PAGE_URL_UNSUPPORTED`, optional pre-search Part-Focus & crop box, one-click Curated Archetype cards; caches resized blob/dataUrl in client memory + `sessionStorage` keyed by `querySessionId`).
- Implement `DiscoveryWorkspace`, `SewistFilterBar` (Woven/Knit pills, single-value *My Full Bust* `32"–64"+` and *My Full Hip* `32"–68"+` sliders with `Any` reset, Format & Skill multi-select pills), and `PatternMatchCard` (Cover ↔ Front/Back Technical Flat toggle with `<link rel="preload">` / hidden eager image warm-up, **Matched** sage chips, **Diff / Minor Hack** ochre chips, canonical + designer band sizing readout, direct `/go/[pattern_id]` CTA).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ui/discovery-flow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

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
  - `savePatternViewCuration(deps, input: { viewId: string; constructionProfile: ConstructionProfileV1; sizeBands: SizeBandInput[]; substrateType: SubstrateCompatibility; formats: DeliveryFormat[]; skillLevel: SkillLevel; adminUserId: string }): Promise<void>`
  - `setPatternPublishStatus(db: Queryable, patternId: string, status: 'draft' | 'published' | 'unpublished' | 'takedown'): Promise<void>`
  - `mergeSizeBandIntoPattern(db: Queryable, sourcePatternId: string, targetPatternId: string, bandLabel: string): Promise<void>`
  - `getTelemetrySummary(db: Queryable, windowDays: 7 | 30): Promise<TelemetrySummary>`

- [ ] **Step 1: Write failing tests for Admin allowlist guard, Save & Re-Embed sync, maker suspension cascade, and CTR telemetry**

Create `tests/admin/curation-and-auth.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { savePatternViewCuration, setPatternPublishStatus, mergeSizeBandIntoPattern } from '@/modules/admin/curation-actions';
import { getTelemetrySummary } from '@/modules/admin/telemetry-repo';

describe('Atelier Admin curation actions, vector sync, and telemetry', () => {
  it('blocks authenticated Supabase users who are not in admin_users allowlist', async () => {
    // Assert requireAdminUser throws 403 Forbidden when auth user email/id is absent from admin_users
  });

  it('regenerates canonical_texts and all non-null 768-d vectors atomically when Steph edits construction_profile', async () => {
    // Edit neckline_type from 'scoop' to 'square' via savePatternViewCuration -> assert canonical_texts.bodice_neckline contains 'square', vec_bodice updated, human_verified = true
  });

  it('merges a separate Curve draft pattern into a Straight pattern as a second pattern_size_bands row and removes duplicate parent', async () => {
    // Call mergeSizeBandIntoPattern -> target pattern now has 2 pattern_size_bands rows; source duplicate deleted
  });

  it('immediately hides all maker patterns from executeSessionSearch when maker vetted_status is set to suspended or pattern is set to takedown', async () => {
    // Suspend maker -> executeSessionSearch returns 0 patterns from that maker without deleting audit history
  });

  it('computes 7d/30d search volume, p50/p95 latency, outbound CTR, per-maker clicks, and daily spend', async () => {
    const summary = await getTelemetrySummary(pg, 7);
    expect(summary.outboundCtr).toBeGreaterThanOrEqual(0);
    expect(summary.makerClicks).toBeInstanceOf(Array);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin/curation-and-auth.test.ts`
Expected: FAIL with missing `@/modules/admin/*` modules.

- [ ] **Step 3: Implement `auth.ts`, `curation-actions.ts`, `telemetry-repo.ts`, `middleware.ts`, and `/admin/*` screens**

- Implement `requireAdminUser` checking Supabase session + `SELECT user_id, email, role FROM admin_users WHERE user_id = $1`, and `src/middleware.ts` guarding `/admin/:path*` (except `/admin/login`) and `/api/admin/:path*`.
- Implement `savePatternViewCuration` validating `ConstructionProfileV1Schema`, running `serializeCanonicalRegions` + `TextEmbedder.embedRegions(..., 'RETRIEVAL_DOCUMENT')`, updating `pattern_views` (`human_verified = true`, `verified_by`, `verified_at`), and upserting `pattern_size_bands` + `patterns` inside `withTransaction`.
- Build `/admin/login`, `/admin/makers` (opt-in permission note + UTM/affiliate + approve/suspend), `/admin/imports` (CSV upload + Shopify URL trigger polling `POST /api/admin/ingestion/process-chunk` (`maxDuration = 60`)), `/admin/patterns` (queue flagging `ai_confidence < 0.80` or missing bust/hip), `/admin/patterns/[id]` (split-view zoomable Technical Flat + Styled Photo vs. structured tag & multi-band size editor + Publish/Unpublish/Takedown), and `/admin/telemetry`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin/curation-and-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/admin src/middleware.ts src/app/admin src/app/api/admin tests/admin
git commit -m "feat(admin): add Atelier curation cockpit, auth allowlist, automatic Save & Re-Embed sync, and CTR telemetry"
```

---

### Task 10: Offline Benchmark Evaluation Harness & Smoke Release Gate (`pnpm eval:benchmark`)

**Files:**
- Create: `src/modules/eval/metrics.ts`
- Create: `eval/fixtures/smoke-v1/manifest.json`
- Create: `scripts/eval/run-benchmark.ts`
- Modify: `package.json` (add `"db:seed": "tsx scripts/db-seed.ts"` and `"eval:benchmark": "tsx scripts/eval/run-benchmark.ts"`)
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

Run: `npx vitest run tests/eval/benchmark-harness.test.ts`
Expected: FAIL with missing `@/modules/eval/metrics` and `scripts/eval/run-benchmark.ts`.

- [ ] **Step 3: Implement `metrics.ts`, `eval/fixtures/smoke-v1/manifest.json`, and `scripts/eval/run-benchmark.ts`**

- Implement `evaluateBenchmarkRun` computing Top-3 hit rate (`any pattern in rankedPatternIds.slice(0, 3) has grade >= 1`), Print-Trap Contamination@3 (`any pattern in slice(0, 3) is in printTrapPatternIds`), reciprocal rank (`1 / (firstHitIdx + 1)`), graded `NDCG@5` using gain `(2^grade - 1) / log2(rank + 1)`, per-`FocusRegion` breakdowns, p50/p95 latency, and release gates (`top3RelevanceRate >= 0.85`, `printTrapContaminationAt3 === 0`, `latencyP95Ms < 3500`).
- Create `eval/fixtures/smoke-v1/manifest.json` with 15 synthetic benchmark queries spanning `full_silhouette` dresses & tops, `bodice_neckline` cross-category matching, `sleeves_armscye`, `skirt_hemline`, Straight vs. Curve measurement filters, and floral/plaid print-trap negative pairs.
- Implement `scripts/eval/run-benchmark.ts` supporting `pnpm eval:benchmark --smoke` (in-process `PGlite` + deterministic smoke fixtures for CI/offline verification, or live Gemini API when `--live-ai` is passed) and `pnpm eval:benchmark --dataset eval/benchmark-v1` (live production pipeline against staging/local DB for Steph's 50+ query launch gate), writing a Markdown + JSON scorecard to `eval/reports/` and exiting `1` if `!scorecard.gatesPassed`.

- [ ] **Step 4: Run full test suite and production Next.js typecheck/build**

Run: `npx vitest run && npm run build`
Expected: All test suites PASS and Next.js production build completes with zero TypeScript or route errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/eval eval scripts/eval package.json tests/eval
git commit -m "feat(eval): add offline benchmark evaluation CLI, metrics scorecard, and 15-query smoke gate"
```
