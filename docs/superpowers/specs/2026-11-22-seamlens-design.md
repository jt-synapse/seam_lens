# SeamLens — Master Project Scope & Design Document

**Date:** 2026-11-22  
**Client / Product Owner:** Steph  
**Technical Lead / Partner:** Developer (SynapseFaster)  
**Status:** Ready for Approval  

---

## 1. Intent & Why

Sewists frequently spot a garment in the wild, on Pinterest, or on Instagram and want to sew it—but **sewing pattern discovery is broken**:

- **Google Lens / general visual search** surfaces ready-to-wear retail listings or matches by fabric print/color rather than garment construction.
- **Existing pattern platforms** (e.g., **Threadloop**, **The Fold Line**, **PatternReview**) rely on text search and manual filters; none offer automated image-to-pattern visual search.
- **Etsy** is heavily saturated with low-quality, AI-generated $2–$5 patterns with broken grading and impossible geometry, making it hard for sewists to trust what they find.

**SeamLens** solves this by pairing **construction-aware visual search** with a **curated, vetted catalog of independent pattern makers**, wrapped in a tactile, editorial web experience.

---

## 2. Goals, Non-Goals, & Anti-Goals

### Goals (v1)
1. **Image-to-pattern discovery:** Upload a garment photo/screenshot (or paste a direct image URL) and receive ranked, relevant indie sewing patterns in seconds. *(Builder call: direct image URLs and file/camera/screenshot uploads only in v1; no Instagram/Pinterest post-URL scraping.)*
2. **Construction-over-print matching:** Match silhouette, seam lines, neckline, sleeve style, closures, and drape—not fabric color or print.
3. **Part-level focus:** Allow users to focus the search on a specific garment region (e.g., *only* the neckline, sleeve, or skirt) via a lightweight crop/region selector.
4. **Explainable results:** Display plain-English match reasons on every result (e.g., *"Matches: square neckline, puff sleeve, gathered midi skirt"*).
5. **Sewist-grade filtering:** Filter results by **fabric type** (woven vs. knit/stretch), **size range** (normalized to canonical **bust & hip measurements in inches**, stored alongside the maker's label—*our call*), **pattern format** (A4/Letter PDF, A0 copyshop, projector, paper), and **skill level**.
6. **Trusted indie catalog:** Launch with a focused, high-accuracy catalog of **~300–500 vetted patterns** across **Dresses & Tops** from **15–25 reputable independent makers**.
7. **Editorial, tactile aesthetic:** Deliver a calm, fabric-inspired visual identity (negative space, clean navigation, tactile surfaces inspired by Fold Atelier and Kripalani Tailors).

### Non-Goals (Deferred to Phase 2 / Phase 3)
- **Native checkout, payment processing, or PDF hosting/delivery** (v1 links out to the maker's website).
- **User accounts for sewists, saved stashes, wishlists, or social feeds/community makes** (Phase 2+; note that *admin login* for Steph's curation dashboard IS in v1).
- **Automated fabric & notions pairing / partner store feeds** (Phase 2).
- **Native iOS / Android apps** (Phase 3; v1 is mobile-first responsive web).
- **Physical warehouse or supply fulfillment** (Phase 3+ long-term stretch).
- **Full-catalog coverage** (pants, outerwear, menswear, kids, bags) at launch.

### Anti-Goals (What Would Make This a Failure)
- **Unvetted or AI-slop patterns in search results:** Letting low-quality or fraudulent Etsy-style listings into the index destroys sewist trust immediately.
- **Unauthorized scraping of indie makers:** Indexing designer photos without permission or attribution will alienate the indie sewing community.
- **Print-driven search results:** Returning a floral t-shirt when the user uploaded a floral wrap dress.
- **Heavy, cluttered marketplace UI:** Overwhelming the upload-and-discover flow with ads, popups, or dense tables.

---

## 3. Constraints & Assumptions

- **Catalog & IP:** All v1 patterns must come from **vetted indie makers** via opt-in onboarding, explicit permission, or approved Shopify/WooCommerce product feeds, with clear designer attribution and direct outbound links.
- **Cost & Unit Economics:** Vision LLM calls per user query and per pattern ingestion carry variable API costs. v1 must include basic rate limiting, image resizing/compression before LLM calls, and query/result caching where practical.
- **Mobile-first web:** Most sewists browse inspiration on phones (Instagram/Pinterest), so camera/photo-library upload on mobile Safari/Chrome must feel effortless without requiring an app-store download.
- **Partnership & Governance (Non-Code Prerequisite):** Before full launch, Steph and the Developer should formalize:
  - Revenue/ownership terms (replacing vague "percentage of profits" with gross revenue share, equity with vesting, or build fee + revenue share).
  - Who covers ongoing hosting, domain, and Vision LLM API costs during beta.
  - Division of labor: Steph owns maker outreach/vetting and aesthetic direction; Developer owns product/engineering.

---

## 4. Approaches Considered & Selected Direction

### Options Evaluated

1. **Approach 1: Hybrid Construction-Profile Search — Vision LLM + `pgvector` (SELECTED)**
   - **How it works:** At ingestion time, a Vision LLM analyzes each pattern's photos and technical line drawings (flats) to generate a normalized JSON construction profile (category, neckline, sleeve, bodice, skirt/hem, closure, woven/knit) plus vector embeddings stored in **PostgreSQL + `pgvector`**. At query time, a Vision LLM strips out color/print noise from the user's photo (or cropped region) into the same structured JSON + embedding, then Postgres runs a hybrid query (hard sewist filters + vector similarity + tag overlap) and formats plain-English match explanations.
   - **Trade-offs:** ~$0.005–$0.02 per search and ~2–4s latency, *but* solves the fabric-vs-construction problem out of the box, explains why patterns matched, supports part-level focus, and requires zero custom ML training.

2. **Approach 2: Pure Vision Embeddings (CLIP / SigLIP)**
   - **How it works:** Embed pattern photos and user uploads directly into a vector index with metadata filters.
   - **Trade-offs:** Sub-second latency and near-zero per-query cost, *but* heavily weights fabric print, color, and styling over seam construction and cannot explain matches. Rejected because it fails the core product differentiator.

3. **Approach 3: Strict Taxonomy + SQL Filtering Only**
   - **How it works:** Pre-tag every pattern with fixed taxonomy labels; map user uploads to those labels via Vision LLM and run pure SQL.
   - **Trade-offs:** Simple and deterministic, *but* brittle on nuanced silhouettes or hybrid designs and loses visual proportion matching. Rejected as primary search (though structured tags are kept inside Approach 1).

### Product Direction: Visual Search Aggregator First
v1 operates as a **Visual Search Aggregator** (outbound links to makers, optional affiliate/UTM tracking) rather than a native checkout marketplace. This avoids cold-start marketplace friction, sales tax/VAT compliance, and PDF fulfillment overhead while proving visual search accuracy first.

---

## 5. System Architecture & Product Scope (v1)

### 5.1 Tech Stack (Starting Direction)
- **Frontend:** **Next.js (App Router, TypeScript, Tailwind CSS)** — mobile-first responsive web app, deployed on **Vercel** (or equivalent).
- **Database & Vector Store:** **PostgreSQL with `pgvector`** (e.g., **Supabase**), storing pattern metadata, maker records, normalized construction JSON, and vector embeddings in one place.
- **Image Storage:** **Supabase Storage** or **Cloudflare R2** for resized/cached pattern thumbnails and technical flats (temporary user uploads processed in-memory or short-TTL bucket with auto-cleanup).
- **AI / Vision Pipeline:** Multimodal Vision LLM (e.g., Gemini / OpenAI vision-capable model via structured JSON output) + text/multimodal embedding model.
- **Analytics & Click Tracking:** Lightweight outbound click logging (`/go/[patternId]` redirect or event table) to measure maker traffic and conversion potential.

### 5.2 Core User Flows (v1)
1. **Home & Upload:**
   - Clean, editorial landing page with a fabric-textured backdrop and negative space.
   - Prominent **Upload Photo / Take Photo / Paste Direct Image URL** entry point (with a brief tip for mobile users to screenshot from Instagram/Pinterest and upload).
   - Optional quick-start example garments so first-time visitors can test search in one click.
2. **Focus & Filter (Pre- or Post-Search):**
   - Optional **Part Focus** selector on the uploaded image: `Full Garment` (default), `Neckline / Bodice`, `Sleeves`, or `Skirt / Hem` (implemented as a simple crop box or region prompt).
   - Sewist filters: **Woven vs. Knit**, **Size Range**, **Pattern Format** (PDF A4/Letter, A0, Projector, Paper), **Skill Level**.
3. **Results & Match Explanation:**
   - Grid/list of ranked indie patterns showing: pattern cover photo + technical flat (if available), pattern name, **vetted maker badge/name**, price, key specs (woven/knit, size range), and **Match Callouts** (e.g., *"Matches: sweetheart neckline · flutter sleeve"*).
   - Primary CTA: **"View Pattern on [Maker Site]"** (tracked outbound link).
4. **Web-Based Admin Dashboard & Batch Ingestion (Steph + Developer):**
   - **Batch ingestion (our call):** Developer runs batch imports from maker-approved CSV/JSON files or public Shopify `/products.json` feeds (no live OAuth/continuous store syncs in v1), automatically running the Vision LLM construction-profile extractor and embedding generator per pattern view.
   - **Web-based Admin UI:** Authenticated web dashboard (for Steph and the developer) to review imported patterns and their views, edit `construction_profile` tags, bust/hip inch ranges, and metadata, and publish/unpublish patterns to live search.

### 5.3 Data Model (Conceptual)
- `makers`: `id`, `name`, `website_url`, `platform_type` (`shopify` | `woocommerce` | `manual`), `vetted_status`, `affiliate_code`, `created_at`
- `patterns`: `id`, `maker_id`, `title`, `category` (`dress` | `top` | `both`), `product_url`, `price_cents`, `currency`, `fabric_type` (`woven` | `knit` | `both`), `bust_min_in`, `bust_max_in`, `hip_min_in`, `hip_max_in`, `maker_size_label`, `formats` (array), `skill_level`, `published` (boolean) *(our call: canonical bust/hip inches for cross-maker filtering)*
- `pattern_views` *(1:N per pattern — our call)*: `id`, `pattern_id`, `view_label` (e.g., `"View A - Dress"`, `"View B - Top"`), `cover_image_url`, `flat_image_url`, `construction_profile` (JSONB), `embedding` (`vector`)
- `search_events` & `outbound_clicks`: `id`, `created_at`, `focus_region`, `filters_used`, `matched_pattern_ids`, `clicked_pattern_id`

---

## 6. Phased Product Roadmap

| Phase | Focus | Key Capabilities | Revenue Lever |
| :--- | :--- | :--- | :--- |
| **Phase 1: MVP (Web)** | Prove visual search accuracy & seed vetted supply | Photo upload + part-focus crop, hybrid construction search, sewist filters, outbound maker links, admin ingestion tool (300–500 Dresses & Tops) | Outbound click tracking, affiliate links, or free to seed maker adoption |
| **Phase 2: Ecosystem** | Retention & project execution | Lightweight accounts (saved searches/wishlists), **automated fabric & notions pairing** (parse yardage/notions and link partner fabric shops), maker analytics dashboard | Fabric/notions affiliate cuts, featured indie maker placements, brand sponsorships |
| **Phase 3: Scale** | Own transaction & mobile channels | Native checkout & PDF library, native iOS/Android app (share-from-Instagram/Pinterest), community "makes" gallery, physical kits/warehouse | Marketplace commission/royalty, ad network, physical fulfillment margins |

---

## 7. What's Left to the Builder (Builder Discretion)
Unless specified later, the builder has discretion to choose:
- Exact Vision LLM provider/model and embedding dimensions (balancing cost, latency, and JSON schema reliability).
- Exact construction taxonomy schema fields inside `construction_profile` JSONB (e.g., neckline enum values, sleeve types, waist styles).
- Hybrid ranking weights (vector cosine similarity vs. structured attribute overlap) and fallback behavior when strict filters return few results.
- Image preprocessing details (max upload resolution, EXIF stripping, temporary upload retention/TTL).
- Rate-limiting thresholds and caching strategy for repeated/example queries.
- UI component library, typography, and responsive breakpoints implementing the editorial aesthetic.

---

## 8. 90-Day Success Criteria & Steph Alignment Checklist

### Suggested 90-Day Launch Targets
- **Supply:** 15–25 vetted indie makers onboarded; 300–500 Dresses & Tops patterns indexed.
- **Quality:** Qualitative review confirms top-5 results match garment construction (not just color/print) on a test set of 30+ real-world inspiration photos.
- **Traction:** Tracked outbound click-through rate to indie maker shops and repeat search usage.

### Pre-Build Alignment With Steph
1. Confirm **Aggregator v1** (outbound links, no checkout/PDF hosting in v1).
2. Confirm **Dresses & Tops** starter scope and who is recruiting the first 15–25 indie makers.
3. Finalize **Domain Name** shortlist and visual brand palette (using [Screenshot 2026-11-20 at 9.33.59 PM.png](file:///Users/synapse/synapse_faster/SeamLens/Screenshot%202026-11-20%20at%209.33.59%20PM.png) as aesthetic anchor).
4. Sign a simple **Partnership / Scope Agreement** covering revenue share (vs. net profit), API/hosting cost ownership, and monthly budget caps.
