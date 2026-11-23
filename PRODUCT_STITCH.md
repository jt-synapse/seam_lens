# Product Requirements Document (PRD): SeamLens Studio (v1)

**Product Name:** SeamLens Studio  
**Target Release:** v1.0 MVP  
**Status:** Approved & Active Implementation  
**Client / Product Owner:** Steph  
**Technical Lead & System Architect:** Developer (SynapseFaster)  
**Document Revision:** 1.2 — Atelier Foundation  

---

## 1. Executive Summary & Vision

### 1.1 Problem Statement
When sewists discover garment inspiration across social media (Instagram, Pinterest, TikTok), vintage archives, or ready-to-wear street style, finding the corresponding sewing pattern is broken:
- **Commercial Visual Search (Google Lens / Pinterest Visual Search):** Surfaces ready-to-wear fast fashion or retail e-commerce listings, heavily indexing superficial fabric prints, colors, and surface graphics rather than physical garment construction, grainlines, or seam topography.
- **Pattern Aggregators (The Fold Line, Threadloop, PatternReview):** Rely purely on text search and manual faceted filtering; neither provides automated image-to-pattern discovery.
- **Unvetted Marketplaces (Etsy):** Flooded with unregulated, AI-hallucinated $2–$5 digital patterns with broken grading, unsewable armscyes, and impossible geometric draftings, eroding sewist trust.

### 1.2 Product Vision
**SeamLens Studio** is a construction-aware optical pattern discovery platform and vetted indie atelier compendium. It translates uploaded garment imagery into structured construction profiles (neckline, sleeve type, bodice drape, skirt volume, dart geometry) to match sewists with verified, high-integrity independent patternmakers.

---

## 2. Core Pillars & Guardrails

| Principle | Description | Product Implication |
| :--- | :--- | :--- |
| **Construction Over Surface Print** | The vision engine analyzes seamlines, ease, darts, and drape, suppressing floral prints, checks, and colors. | Prevents surfacing a floral t-shirt when the user uploads a floral bias-cut midi dress. |
| **Zero AI Slop Guarantee** | 100% vetted independent patternmakers with proven grading curves, copyshop A0 files, and true-gauge drafting. | No unverified Etsy scrapes, no uncurated scraping bots, no predatory AI-generated PDFs. |
| **Measurement-True Standard** | Bust and hip ranges normalized to canonical inches (32"–64"+) alongside designer size labels. | Solves cross-brand vanity sizing discrepancies across indie makers. |
| **Tactile Atelier Aesthetic** | High editorial tactile design inspired by couture tailoring, natural linens, and generous negative space (inspired by Fold Atelier & Kripalani Tailors). | Elevated, serene digital studio rather than a cluttered, ad-heavy discount marketplace. |

---

## 3. Scope & Phasing

### 3.1 Phase 1 MVP Scope (Current Phase)
1. **Garment Ingestion & Upload Dock:** Drag-and-drop file upload, mobile camera snap, direct image URL paste, and one-click curated archetypes.
2. **Part-Focus Regional Isolation:** Interactive selector allowing sewists to isolate:
   - `Full Silhouette` (default)
   - `Bodice & Neckline` (sweetheart, square, cowl, boatneck, etc.)
   - `Sleeves & Armscye` (puff, dolman, raglan, set-in, bishop, sleeveless)
   - `Skirt & Hemline` (gathered tier, bias slip, A-line, circle, wrap)
3. **Sewist-Grade Parametric Filters:**
   - **Fabric Substrate:** Woven vs. Knit / Stretch (essential mechanical distinction).
   - **Canonical Measurements:** Full Bust (inches) and Full Hip (inches) range sliders.
   - **Delivery Formats:** PDF (Print at Home A4/US Letter), Copyshop A0 (wide format), Projector file, Paper envelope.
   - **Skill Level:** Confident Beginner, Intermediate, Advanced / Couture.
4. **Results & Match Engine (Outbound Aggregator):**
   - Ranked match cards with primary cover photo + instant technical flat line-drawing toggle.
   - Plain-English construction match callout chips (e.g., *"Matched: Deep Square Neckline · Elastic Shirring · Elbow Puff"*).
   - Tracked outbound link (`/go/[pattern_id]`) to vetted indie maker's direct webshop.
5. **Atelier Admin Curation Dashboard (Steph & Engineering):**
   - Web interface for reviewing imported Shopify/CSV batch drafts.
   - Tag editor for fine-tuning `construction_profile` JSON attributes and canonical bust/hip bounds.
   - Single-click publish/unpublish live index toggle.

### 3.2 Non-Goals / Deferred to Phase 2+
- **In-App Checkout & Digital PDF Hosting:** (Deferred to Phase 3; v1 is strictly an outbound aggregator to avoid marketplace sales tax, VAT-MOSS, and checkout friction).
- **Social Feeds, Stash Tracking & User Accounts:** (Phase 2).
- **Automated Fabric Yardage & Haberdashery Pairing:** (Phase 2).
- **Native iOS / Android Apps:** (Phase 3; v1 is fully responsive mobile-first web).

---

## 4. User Personas & Target Audiences

### Persona A: The Mindful Maker (Primary End-User)
- **Profile:** Intermediate hobby sewist, 28–45 years old. Browses Pinterest/Instagram for slow fashion capsules.
- **Pain Point:** Has 40+ saved screenshots of dresses and tops but spends 3 hours manually cross-checking pattern blogs and hashtags trying to identify what pattern matches the silhouette.
- **Goal:** Drop a screenshot, select the sleeve or neckline, and immediately get the top 3 vetted indie patterns with verified grading up to her hip measurement.

### Persona B: The Atelier Curation Lead (Steph)
- **Profile:** Industry specialist and design curator. Manages relationships with 15–25 independent pattern designers.
- **Pain Point:** Needs full editorial control to ensure poor quality or improperly drafted patterns never enter the catalog.
- **Goal:** An intuitive administrative cockpit to audit computer-generated construction profiles and authorize live catalog publishing in seconds.

---

## 5. System Architecture & Data Schema

### 5.1 Architecture Overview
- **Application Framework:** Next.js (App Router, TypeScript, Tailwind CSS) deployed on modern edge infrastructure.
- **Database & Vector Pipeline:** PostgreSQL with `pgvector` extension (e.g., Supabase), unifying relational pattern metadata with multi-modal embeddings.
- **Vision Ingestion Pipeline:**
  - Ingestion: Multimodal Vision LLM extracts normalized `construction_profile` JSON + vector embeddings from maker flat drawings and product photos.
  - Search Query: User upload is processed to extract structural JSON tags + regional vector embedding, matched via hybrid cosine similarity + hard SQL filter execution.

### 5.2 Core Data Entities
```json
// Pattern View Construction Profile (JSONB)
{
  "view_code": "view_a_midi",
  "garment_category": "dress",
  "silhouette": "tiered_midi",
  "neckline": { "type": "square", "depth": "mid", "finish": "facing" },
  "sleeves": { "type": "puff", "length": "elbow", "cuff": "elastic_casing" },
  "bodice": { "darts": "none", "fit": "close_shirred", "waist": "natural" },
  "closure": "pullover_elastic",
  "fabric_suitability": ["linen", "cotton_poplin", "double_gauze"],
  "substrate_type": "woven"
}
```

---

## 6. Key Performance Indicators (90-Day MVP Targets)

1. **Catalog Density:** 15–25 vetted indie pattern houses onboarded with 300–500 active Dress & Top views indexed.
2. **Optical Accuracy:** ≥85% top-3 match relevance on standard construction features across a verified benchmark suite of 50 street/runway photos.
3. **Sewist Engagement:** >25% outbound click-through rate (CTR) from match result cards to indie maker storefronts.
4. **Search Latency:** End-to-end visual query to ranked result rendering in under 3.5 seconds.
