# SeamLens

## Concept

**Granola Notes**

### The Problem Being Solved

- Sewing pattern discovery is broken: Google image search only surfaces major retailers
- Large community of independent pattern makers whose work doesn’t appear in search results
- Existing text-search pattern sites (one app mentioned) don’t solve the visual matching problem
- Current workaround: manually hunting individual sites, time-consuming and often fruitless

### Product Vision

- Image-based sewing pattern search engine: upload a photo of a garment, get matching patterns back
- Primary focus: marketplace, not social (social features possible later)
- Pattern library sourced from independent makers
- Growth path: when a pattern is selected, surface recommended fabrics and notions from partner sites
- Long-term stretch: own warehouse and physical supply fulfillment

### Technical Feasibility

- Image recognition and pattern matching: confirmed doable
- LLM tooling can power image processing and detection features
- Start with website first, then move to mobile app once traction builds
  - Website is easier to iterate on and required regardless

### Business Model (Early Thinking)

- Revenue options discussed, none finalized:
  - Royalty or cut per pattern download
  - Click-through fees to maker websites
  - Ad revenue from brands like Michaels once scale is reached
  - Service fees from pattern makers
- Partnership structure: Josh (note-taker) as first customer, developer gets a percentage of profits

### Next Steps

- **Draft technical architecture doc and share for feedback**
  - Developer to put together a Google Doc outlining the technical approach; Steph to add references, notes, and any visual examples.
- **Come up with domain name candidates**
  - A few ideas in progress but nothing confirmed; share shortlist for input. Developer offered to set up domain registration once a name is chosen


## Owner

Project for Steph
Maybe draw up some kind of contract for her to sign and have it be an office SynapseFaster product.

### Notes

Texts from Steph:

I really love this website with the fabric background, the negative space and simplistic menu design
https://kripalanitailors.com/

I love the look of this, with the interface on an object with fabric in the background

![alt text](<Screenshot 2026-11-20 at 9.33.59 PM.png>)


### Gemini Logs

Right now, your notes describe two different products blended together: a visual search engine (discovery) and a two-sided marketplace (transactions). Because Steph isn't sure exactly what she wants yet, the fastest way to get clarity—and avoid scope creep—is to present her with concrete trade-offs and a phased plan that protects her long-term vision while keeping v1 buildable.

Here is how to flesh out the product, technical approach, business model, and client discovery questions based on your notes.

1. Resolve the Core Product Fork: Search Aggregator vs. Marketplace

Attempting to launch both visual search and a full checkout marketplace on Day 1 creates a heavy cold-start problem: indie makers won't upload files to an unproven store, and sewists won't use a search engine with only 20 patterns.

Present Steph with a clear Start vs. Grow split:

⚬ Option A: Visual Search Aggregator First (Recommended for MVP)
  ⚬ You index indie pattern catalogs (with maker permission or via simple Shopify/WooCommerce feed syncs) and link sewists out to the maker's site to buy.
  ⚬ Why it wins for v1: Fast catalog growth, zero payment/tax/PDF-delivery overhead, and easy maker buy-in ("free traffic").
  ⚬ Monetization: Affiliate links, click-through fees, or paid "featured maker" placements.
⚬ Option B: Native Marketplace First
  ⚬ Makers upload PDFs directly to your platform; you handle checkout, digital delivery, sales tax/VAT, and take a royalty/commission (competing directly with Etsy's fees).
  ⚬ Why it's risky for v1: Much higher engineering, legal, and customer support overhead before proving visual search actually converts users.

2. The Secret Sauce: Solving the "Fabric vs. Silhouette" Problem

This is the single biggest detail that will make Steph feel like you deeply understand the sewing domain—and it directly shapes your technical architecture.

Standard visual search (like Google Lens or off-the-shelf image embeddings) fails for sewing because it heavily weights color, fabric print, and styling. If a user uploads a photo of a floral wrap dress, naive image similarity will return floral t-shirts instead of a solid-colored wrap dress pattern.

How to design the matching experience:

⚬ Match construction, not print: Use a vision LLM to extract standardized garment construction features (silhouette, neckline, sleeve style, closures, waist seam, darting, woven vs. knit structure) and match against both maker photos and technical line drawings (flats).
⚬ Explain why a pattern matched: Show match callouts on results (e.g., "Matches: square neckline, puff sleeves, midi A-line skirt"). Even an 80% match is useful to a sewist if they know what minor hack is needed.
⚬ Non-negotiable sewist filters: Visual search gets them in the door, but sewists won't buy without filtering by:
  ⚬ Size range / inclusivity (crucial in the indie sewing community—bust/hip measurements)
  ⚬ Fabric type (woven vs. knit/stretch)
  ⚬ Pattern format (PDF A4/Letter, A0 copyshop, projector files, printed paper)
  ⚬ Skill level (beginner to advanced)

3. Phased Product Roadmap

Giving Steph a 3-phase roadmap shows her big vision (fabrics, mobile app, warehouse) is accounted for without bloating the initial build.

Phase	Core Focus	Key Features	Revenue Lever
Phase 1: MVP (Web App)	Prove visual search accuracy & build catalog	Mobile-friendly web upload (camera or image URL), hybrid visual + attribute search, core sewist filters, outbound links to indie makers, basic maker onboarding form	Affiliate links / click-through tracking (or free to seed supply)
Phase 2: Ecosystem (Web + Light Accounts)	Increase retention & average order value	Saved pattern wishlists, automated fabric & notions pairing (LLM reads pattern yardage/notions and matches partner shop links), maker dashboards & analytics	Partner fabric/notions affiliate cuts, featured maker listings, brand sponsorships
Phase 3: Scale (Marketplace & Mobile)	Own the transaction & expand channels	Native checkout & PDF library, native iOS/Android app (with share-from-Instagram/Pinterest extensions), community "makes" gallery, physical kits/warehouse	Marketplace take-rate (royalty per download), ad network, physical inventory margins

4. High-Level Technical Architecture (For Your Google Doc)

To keep iteration cheap and fast while supporting accurate visual search:

⚬ Frontend: Mobile-first responsive web app (e.g., Next.js / React). Sewists heavily browse Pinterest and Instagram on phones—a clean mobile web upload flow (and eventual PWA) eliminates the need for a native app on Day 1.
⚬ Hybrid Search Pipeline:
  1. Catalog Ingestion: For each indie pattern, store metadata + photos + technical line drawings. Run a vision LLM once at ingestion time to generate a normalized JSON construction profile (garment category, neckline, sleeve, closure, fit) alongside vector embeddings.
  2. User Query: User uploads a garment photo → Vision LLM strips away color/pattern noise and outputs the exact same structured construction profile + embedding → Run hybrid retrieval (vector similarity + structured tag matching + hard filters like size/fabric type).
⚬ Database: PostgreSQL with pgvector. Keeping relational data (sizes, prices, makers, affiliate URLs) and vector embeddings in one database avoids managing separate search infrastructure early on.
⚬ Fabric & Notions Pairing (Phase 2): Parse pattern descriptions ("2.5 yards mid-weight linen, 18-inch invisible zipper") into structured requirements and query partner affiliate feeds (e.g., Mood, indie fabric shops, Michaels).

5. Business & Partnership Watch-Outs

Before writing code, there are three practical business gaps in your notes worth flagging early:

1. Profit-share structure: "Developer gets a percentage of profits" is notoriously hard to enforce cleanly—early startups often reinvest all revenue, leaving "net profit" at $0 for years even when the product succeeds. Consider proposing a clearer structure: gross revenue share, equity with vesting, or a reduced build fee plus revenue share.
2. Ongoing AI/API unit economics: Vision LLM calls per image upload and catalog ingestion have real variable costs. Clarify who pays for hosting, domains, and API usage during development and early traction, and plan for rate limiting or caching so a viral spike doesn't blow up your bill.
3. Intellectual Property & Scraping Ethics: Indie pattern makers are a tight-knit, fiercely protective community. Scraping their photos without permission can spark backlash that kills trust overnight. Position the platform as pro-indie maker from Day 1 (opt-in onboarding, clear attribution, direct traffic back to their shops).

6. Decision-Forcing Questions for Your Next Call with Steph

Since she isn't sure what she wants, avoid open-ended questions. Ask concrete "this or that" questions she can react to:

⚬ Supply: "Do you already have 10–20 indie pattern makers who would share their catalogs for a pilot, or do we need to build a cold-outreach / submission portal?"
⚬ Scope: "For launch, are you comfortable linking out to the maker's website to complete the purchase so we can focus 100% on nailing the visual search?"
⚬ Niche Focus: "Should v1 cover all garments, or should we nail one high-demand category first (like dresses and tops) so the search results feel impressively accurate right away?"
⚬ Success Metric: "What would make you consider the first 90 days after launch a win—number of patterns indexed, daily searches, or outbound clicks to makers?"
⚬ Competitors: "Which text-search pattern app was mentioned in our notes (e.g., Threadloop, The Fold Line, PatternReview), and what specifically frustrates you about using it?"


SeamLens
Owner: Steph

Project Idea
Sewing pattern discovery is broken: Google image search only surfaces major retailers
Large community of independent pattern makers whose work doesn’t appear in search results
Existing text-search pattern sites (one app mentioned) don’t solve the visual matching problem
Current workaround: manually hunting individual sites, time-consuming and often fruitless


Technical Scope
Image-based sewing pattern search engine: upload a photo of a garment, get matching patterns back
Primary focus: marketplace, not social (social features possible later)
Pattern library sourced from independent makers
Growth path: when a pattern is selected, surface recommended fabrics and notions from partner sites
Long-term stretch: own warehouse and physical supply fulfillment
Image recognition and pattern matching: confirmed doable
LLM tooling can power image processing and detection features
Start with website first, then move to mobile app once traction builds
Website is easier to iterate on and required regardless







SCRATCH NOTES
Its planned features included uploading a photo, finding similar sewing patterns, recommending fabrics, and identifying where to purchase supplies.
One detailed community response highlighted three requirements:
Matching the actual seam and construction details, not just the general silhouette.
Allowing users to focus on a particular part of a garment, such as the neckline or skirt.
Distinguishing reputable sewing patterns from low-quality listings.





Layer
The User's Problem
Product Opportunity
Inspiration
"I saw something I want to sew."
Image-based search
Discovery
"I don't know which pattern will recreate it."
Garment-aware matching and curated designer catalog
Execution
"What fabric, supplies and skill level do I need?"
Project guidance and shopping recommendations


