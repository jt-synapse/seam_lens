# SeamLens — Formalized Product Brief

**Status: idea-stage brief for Steph (client/cousin) to react to — not a build specification.**
Nothing in the workspace confirms scope, users, pricing, supply, or the name. Every recommendation below is marked as a hypothesis or a decision for Steph. Web sources were used for competitor, user-pain, technology, and monetization context and are linked throughout.

---

## 1. What we actually have — the raw idea, and only that

The entire workspace is two files: [project_idea.md](project_idea.md) (189 lines) and one design-inspiration screenshot. There is no code, README, prototype, or research artifact. Everything attributable to the client comes from the Granola Notes (lines 1–44) and Steph's texts (lines 53–58). Lines 63–136 are headed "Gemini Logs" — prior AI elaboration (aggregator-vs-marketplace options, filters, a 3-phase roadmap, a Next.js/pgvector sketch, decision questions). Those are candidate options awaiting Steph's reaction, **not** client intent, and this brief never cites them as what she wants.

**The stated problem** ([project_idea.md](project_idea.md), lines 9–12): sewing-pattern discovery is broken. Google image search surfaces only major retailers; a large community of independent pattern makers does not appear; existing text-search pattern sites ("one app mentioned," never named) do not solve visual matching; the workaround is manually hunting individual maker sites — time-consuming and often fruitless.

**The stated vision** (lines 16–20): an image-based sewing-pattern search engine — upload a photo of a garment, get matching patterns back — "primary focus: marketplace, not social" (social possible later), a pattern library sourced from independent makers, a growth path to fabric/notions recommendations from partner sites, and a long-term stretch of owning a warehouse for physical fulfillment.

**The stated direction** (lines 24–36): image recognition asserted as "confirmed doable" with LLM tooling (no model, architecture, accuracy target, or test in the original notes); website first, mobile after traction; revenue options — per-download royalty, click-through fees, ads at scale (e.g. Michaels), maker service fees — explicitly "none finalized." A partnership note gives the developer "a percentage of profits" with no percentage, profit definition, or terms. Agreed next steps were only: draft a technical architecture doc for feedback, and propose domain candidates — **the SeamLens name/domain is a working title, not confirmed final** (lines 40–49).

**Steph's only directly quoted input is aesthetic** (lines 53–58): she loves [kripalanitailors.com](https://kripalanitailors.com) — a bespoke tailor's brochure site (Hong Kong tailoring in Birmingham, Alabama since 1978) — for its fabric background, negative space, and simple menu, and loves a screenshot's "interface on an object with fabric in the background" look. That screenshot is third-party inspiration ("FOLD ATELIER"), not a SeamLens prototype. No Steph quote specifies features, users, pricing, or scope.

### The core unresolved ambiguity

The notes call the product both a "search engine" (discovery) and "primary focus: marketplace" (transactions), and list both per-download royalties (implies hosted checkout/PDFs) and click-through fees (implies indexing and linking out). **Whether SeamLens hosts checkout or only indexes and links to makers is the single most consequential open decision.** Search + marketplace are not logically incompatible if phased, but the phasing is unchosen.

### What the workspace does *not* say (gaps, not intent)

- **No target user is specified** in Steph's/Granola material — no segment (hobbyist sewists, tailors, alterations shops, cosplayers, quilters, fashion students), skill level, garment categories, geography, or language. (Precision note: the Gemini section generically says "sewists," floats a beginner-to-advanced filter and "dresses and tops" as a question — AI proposals, not a chosen persona.) Any persona in §3 is a hypothesis to validate.
- **No "sewing app" features beyond visual search** appear in Steph's material: no body measurements/profiles, AR/camera body measurement, pattern drafting or PDF generation/projector files, fabric stash, project tracking, tutorials, accounts, wishlists, or reviews. In the notes, "Lens" means photo-upload visual search only — **not AR fitting**. §4–5 treat those features as market context, not client requirements.
- **No supply or validation specifics**: no maker named, none committed, no catalog size, no *adopted* sourcing/IP method (the Gemini section floats opt-in/Shopify–WooCommerce feed syncs and guesses Threadloop/The Fold Line/PatternReview as the unnamed rival — all unanswered questions), and no user research, interview, survey, waitlist, or willingness-to-pay evidence.
- **No execution specifics**: budget, timeline, success metric, who funds hosting/AI costs, legal entity, or contract terms.

---

## 2. Problem and value proposition (formalized)

**Problem (as stated, unvalidated externally):** A sewist who sees a garment they want to recreate cannot reliably find a *sewable pattern* for it. Keyword/image search favors big retailers and finished garments; indie pattern catalogs are fragmented across individual shops; finding a match means manually hunting site by site.

**Value proposition (proposed wording for Steph to approve):** *"Photograph a garment. Get back independent sewing patterns that actually construct it — filtered so the match is sewable by you, in your size range, format, and skill level — then buy the pattern (and later, matched fabric and notions) without hunting twenty maker sites."*

The differentiator is not "more patterns." It is **visual-first discovery across the indie long tail**, which incumbents (below) do not own: marketplaces are keyword/SEO-driven, libraries are closed catalogs, and drafting tools assume you already know what to make.

---

## 3. Target users — external pain evidence, and a proposed beachhead

External research (not Steph's input) shows sharply different pains per segment:

- **Hobbyist garment sewists** — the strongest, most repeated pain is *fit confidence*, not sewing skill. In a 2024 LSU survey of 162 home sewers, better fit was a primary reason to sew, yet respondents were "not confident in their pattern alterations for fit" despite experience ([LSU thesis](https://repository.lsu.edu/gradschool_theses/5944)). Forum evidence matches: self-measurement/self-fitting alone is physically hard ("You have to contort yourself to take measurements and don't stand naturally" — [PatternReview](https://sewing.patternreview.com/SewingDiscussions/topic/92906)), pattern sizing/ease is confusing ([PatternReview](https://sewing.patternreview.com/SewingDiscussions/Topic/114550/1)), and stash/pattern organization outgrows spreadsheets, causing duplicate purchases. **Implication:** visual discovery is Steph's wedge, but any later fit/stash features tap proven demand — they are Phase-2 candidates, not MVP assumptions.
- **Tailors / alterations shops** — pain is operational: measurements lost in notebooks, promised dates slipping, finished work uncollected ([Cleandy guide](https://www.cleandysoft.com/en/blog/tailor-alteration-software-guide), vendor-published). This is a B2B order-management product — a different surface, likely a later SKU if ever.
- **Cosplayers** — no single pattern matches a character; the workflow is mixing/matching and hacking multiple patterns, under convention-deadline "con crunch." Compelling for visual/part-focused search, but episodic.
- **Quilters** — stash organization pain is real, but they do not need garment fit; a poor fit for a garment-pattern wedge.

**Proposed beachhead (hypothesis):** hobbyist garment sewists who already buy indie PDF patterns and save inspiration photos — because that is exactly the "photo → pattern" job in the notes. Tailors/B2B, quilting, and cosplay-specific workflows are explicitly deferred until Steph picks a segment.

---

## 4. Competitor landscape

The market is fragmented by job; no fetched product owns photo-to-indie-pattern visual search. Pricing below is as fetched in late 2026; vendor-published comparisons (notably MPattern's) are marked and should be re-verified on vendor sites before any pricing decision.

| Product | Job / model | Price (as fetched) | Gap SeamLens could own |
|---|---|---|---|
| [Seamwork](https://help.seamwork.com/hc/en-us/articles/35390792482963-What-s-included-with-an-Unlimited-membership) | Closed pattern library + community/education subscription | Lite $16/mo or $156/yr (2 downloads/mo); Unlimited $21/mo or $180/yr (200+ patterns, unlimited) | Closed catalog; no cross-maker visual search; fixed sizes |
| Etsy (incumbent indie channel) | Keyword marketplace, native checkout | $0.20/listing + 6.5% transaction + 3%+$0.25 processing (≈10%+ all-in) | Discovery is SEO/ads; no garment-photo matching |
| [MPattern](https://www.mpattern.app/en/ai-pattern-making) | Browser made-to-measure block generator (54 blocks from 38 measurements; PDF/SVG/DXF/projector) | One-time €19.99 / $23.99 + optional €2.99/mo cloud; 3 free patterns | Blocks, not fashionable finished designs; heavy measurement entry; no discovery |
| Tailornova / Lekala (via [MPattern comparison](https://www.mpattern.app/en/alternatives/lekala), secondary) | Mix-and-match / per-design made-to-measure | Tailornova $29–49/mo or $10 single; Lekala a few dollars/design | Generation, not indie-catalog discovery |
| [MyBodyModel](https://www.mybodymodel.com/pricing) | Personalized croquis/planning templates | Free preview; credits (Basic $29, Premium $39, 5 credits $59 listed, 2022 page) | Planning only — no patterns |
| [Patternarium](https://www.patternarium.app/pricing) | Pattern stash/catalog organizer + AI envelope scans | Free (25 patterns/3 projects); Pro $47.99/yr | Organizes what you own; doesn't find what to buy |
| Seamly2D / FreeSewing | Free/open-source drafting CAD / parametric patterns-as-code | Free | You draft it yourself; no discovery/marketplace. Anchors price expectations to zero |
| Indie brands (e.g. Tilly and the Buttons) | Own-site PDF/print patterns + beginner education | ~£15 PDF / £19.50 print (search snippet only; page fetch returned 429 — unverified) | Single-brand catalogs — precisely the fragmentation Steph cites |
| Ribblr / Ravelry / LoveCrafts (adjacent craft marketplaces) | Pattern marketplaces (knit/crochet-led) | Ribblr sale fee from 4% (min 25¢), no listing fee; Ravelry/LoveCrafts use sales thresholds (see §7 conflict) | Proof that craft-native low-fee marketplaces exist; none is sewing-visual-search |

**Differentiation to defend:** (1) construction-aware matching (seams/darts/neckline/construction, not just silhouette or color) — the unattributed Scratch Notes in the workspace (lines 165–188) raise seam-detail matching, part-focus (neckline/skirt), and reputable-vs-low-quality pattern distinction as leads from "one detailed community response"; treat these as unvalidated requirements worth testing, since they are exactly where naive image similarity fails sewists; (2) indie long-tail coverage with maker permission/attribution; (3) sewability filters (size range, fabric type, PDF/print/projector, skill) — proposed in the Gemini logs, sensible, but still Steph's to approve.

**Competitive risks:** Google Lens/Pinterest visual search could add pattern results; Etsy could add visual search to a catalog it already hosts; free tools (Seamly2D/FreeSewing) and a one-time $24 generator (MPattern) cap what users will pay for generation alone.

---

## 5. Technical feasibility

**Visual pattern search (the core claim).** The notes assert feasibility without evidence. Honest assessment: image-embedding similarity over maker-provided garment photos is well within current vision-LLM/embedding capability for *candidate retrieval*; the hard part is ranking by *construction* (seam lines, dart placement, closures) rather than superficial similarity (same color/print/fabric drape), and explaining matches so a sewist trusts them. Feasibility therefore hinges less on "can AI match images" and more on (a) a permissioned, well-photographed indie catalog with structured metadata, and (b) a labeled test set of garment-photo → pattern queries with seamstresses judging "would this construct it?" No accuracy claim should be made to users or makers until that pilot exists.

**Camera/AR body measurement — not in Steph's idea; assessed only because of the name.** Do not build it into the MVP, and do not promise it. Leading vendor 3DLOOK self-reports (not peer-reviewed) typical absolute error of 1.5–2.0 cm per measurement vs expert tape ([3DLOOK accuracy framework](https://3dlook.ai/content-hub/mobile-body-scanning-accuracy)). That exceeds normal finished-garment tolerances (±1 cm on chest/waist/hip/length, ±0.5 cm on fit-critical points, per [CMB Sourcing](https://clothingmanufacturerbangladesh.com/journal/garment-measurement-tolerances)), so camera-only measurement suits size recommendation/loose garments, not fitted pattern drafting. It is also B2B-priced (3DLOOK lists $499/mo per 100 scans, $999/mo per 500 — [pricing](https://3dlook.ai/pricing)), requires tight clothing and guided front+side capture, and raises body-image/privacy consent issues. If measurements ever matter, buy/white-label (e.g. [Size Stream](https://www.sizestream.com/technology) API/SDK) as an editable, tape-confirmable aid — never as a tape replacement — after an in-house validation pilot on the actual target population.

**Pattern PDF generation/drafting — feasible, but a different product.** Proven open-source parametric stacks exist ([FreeSewing](https://freesewing.dev), [Seamly](https://seamly.io)), so generating tiled A4/Letter + A0 PDFs from measurements is buildable without inventing a drafting engine. But *SeamLens as written sells other makers' patterns*; generating its own patterns would compete with its supply side. Keep generation out of scope unless Steph explicitly pivots.

**Platform.** Web-first (per the notes) is also the evidence-backed choice: pattern library, upload search, profiles, and link-out/checkout all work in a responsive web/PWA; in-browser AR is blocked on iPhone Safari (no WebXR AR as of 2026), so native apps only earn their cost if a validated camera feature becomes core. Web-first also avoids app-store commissions (Apple's Small Business Program is 15% on IAP — [Apple](https://developer.apple.com/app-store/business-models)) during the phase when margins are thinnest.

**Fabric identification from a photo:** no fetched primary source supports reliable fiber/weight ID from a normal phone photo. Treat as unresolved/experimental — do not promise it.

---

## 6. MVP scope and phased roadmap (recommendation, pending §8 decisions)

The governing principle from subscription/marketplace evidence: ship the smallest testable product that proves willingness to pay and a recurring job; defer anything that doesn't affect the renewal/repeat trigger. Launching search + native marketplace + subscriptions + warehouse at once would test nothing.

**Phase 0 — Validation (before building search).** Name the unnamed competitor and the exact frustration with it; interview 10–15 target sewists with their last "saw it, couldn't find the pattern" story; recruit 10–20 indie makers for a permissioned pilot catalog (opt-in, attribution, feed or manual upload — do not scrape without permission); assemble a 50–100-query labeled test set (inspiration photo → acceptable patterns, judged by sewists). *Exit criterion:* makers will supply catalogs and a prototype ranks an acceptable pattern in the top results often enough that testers say they'd use it over manual hunting.

**Phase 1 — MVP: visual-search aggregator (web).**
- Upload/paste a garment photo → ranked indie pattern matches with match rationale (silhouette + construction cues) and link-out to the maker's existing checkout.
- Sewability filters (garment category narrow at launch — Steph to pick, e.g. dresses/tops — size range, fabric type, format, skill level) and part-focus (neckline/sleeve/skirt) as a testable differentiator.
- Maker pages with clear attribution; quality/reputation signals (ratings, tested/sewn examples) if makers supply them.
- Light accounts only to save searches/boards (repeat-use job), analytics on click-through-to-maker as the core success metric.
- Editorial, fabric-forward design per Steph's stated taste ([Kripalani](https://kripalanitailors.com) reference: fabric textures, negative space, minimal menu).
- *Explicitly out:* native checkout/PDF hosting, body measurement/AR, pattern generation, stash/project tracking, tutorials, social feed, warehouse.

**Phase 2 — Monetize the proven flow.** Fabric/notions recommendations against a chosen pattern (affiliate links to partner sites — already Steph's stated growth path); maker featured placement/service fees; optional consumer freemium *only if* saved-search/project behavior shows recurring use (episodic, per-project use churns subscriptions).

**Phase 3 — Optional native marketplace.** Only if makers ask for it and volume justifies payments/tax/refund/support burden: native checkout with a take rate that beats or justifies vs Etsy (~6.5% + $0.20 + processing) and craft-native 0–4% benchmarks (§7), possibly bundled with subscription value and designer revenue-share. Physical fulfillment/warehouse remains a stretch, not a plan.

---

## 7. Monetization options (benchmarks, then a fit to Steph's undecided list)

- **Subscription library/content:** Seamwork $13–15/mo billed annually to $21/mo monthly bundles patterns + community + sewalongs + fabric discounts — content/community, not patterns alone ([Seamwork](https://help.seamwork.com/hc/en-us/articles/35390792482963-What-s-included-with-an-Unlimited-membership)). Adjacent benchmark: [Making Things](https://www.makingthingsapp.com/pricing) $11.99/mo for 1,000+ knit/crochet patterns + tools, with a "subscriber share" paying designers whose patterns were used. [Craftsy](https://www.craftsy.com/product/premium-membership-2) lists $125/yr for 2,000+ classes with deep first-year discounting. *Fit:* only viable for SeamLens with owned/licensed content and a weekly job — not Phase 1.
- **Marketplace take rate:** [Ribblr](https://ribblr.com/paymentspolicy) charges no listing fee, sale fee from 4% (min 25¢/pattern), reducible via points, via Stripe Connect. Etsy ≈ $0.20 + 6.5% + 3%/$0.25. *Fit:* Phase-3 option; on $5–15 patterns, 2.9%+$0.30 processing alone eats thin percentages — model per-order economics before promising makers anything.
- **Click-through / affiliate:** matches Steph's aggregator-compatible option and the fabric/notions growth path. Requires affiliate programs to actually exist at target retailers (Michaels/Mood rates were **not** researched — open item) and enough click volume; ads (her "at scale" option) come last and can undermine the editorial aesthetic she wants.
- **Maker service/featured fees:** viable in Phase 2 once SeamLens demonstrably sends converting traffic; charging makers before proving traffic inverts the cold-start problem. Threshold-style zero fees for small sellers (mirroring Ravelry/LoveCrafts structures) is the proven maker-recruitment lever.
- **One-off/pay-per-result:** MPattern's one-time ~$24 and Lekala's few-dollars-per-design prove sewists pay per artifact; a paid "deep search / pattern-hack plan" is conceivable later but unvalidated.

**Recommended sequence:** free aggregator to seed supply/demand → affiliate (fabrics/notions) + maker featured fees → only then consider native take-rate or subscription. This sequences Steph's own four options rather than choosing among them prematurely — but the sequence itself needs her sign-off.

---

## 8. Open decisions for Steph (do not assume these)

1. **Host or link out?** Aggregator/index first (recommended), native marketplace now, or aggregator-now/marketplace-later? This decision cascades into payments, tax, refunds, PDF hosting, and maker contracts.
2. **Who is it for first?** Confirm/reject the hobbyist-garment-sewist beachhead; name skill level and launch garment categories (dresses/tops only vs all garments vs a niche like cosplay).
3. **Which competitor frustrates you?** Name the unnamed text-search app/site and what it got wrong — that is the wedge definition.
4. **Supply reality:** Do you know 10–20 indie makers who would pilot a permissioned catalog? Who recruits them, and is scraping without permission off the table (recommended)?
5. **Monetization choice and timing:** Which of your four options leads? Are makers or sewists the paying side first?
6. **Success metric & funding:** What proves Phase 1 worked in 90 days (e.g. click-through rate to makers, return searches)? What budget covers hosting/AI-API costs, and who pays?
7. **Name/domain/brand:** Is SeamLens final? Domain shortlist and trademark check still owed per the notes.
8. **Deal terms:** Contract or not; what "percentage of profits" means (define profit, percentage, term, IP ownership); what Josh's "first customer" role actually is.
9. **Explicit non-goals confirm:** No AR measurement, pattern generation, stash/projects, or social in v1 — agree, or pull one in and accept the cost?

---

## 9. Risks

- **Cold start / supply:** value scales with permissioned indie coverage; makers already get Etsy/own-site traffic and will ask "what do I get?" Free traffic + attribution + no fees early is the offer; exclusivity demands would kill it.
- **Match-quality trust:** silhouette-similar but construction-wrong results waste fabric and trust. Mitigate with construction-aware ranking, honest match explanations, "hack required" labeling, and the Phase-0 labeled test set as a go/no-go gate.
- **IP/images:** indexing needs maker permission for images/metadata; user-uploaded inspiration photos may be copyrighted/retail imagery — needed: takedown process, no redistribution of maker PDFs, clear affiliate/link attribution.
- **Thin economics:** low pattern price points + processing fees + AI inference cost per search. Mitigate: cache/embed once per catalog image, charge only where value is proven (fabrics affiliate, maker services).
- **Platform dependency:** Google/Etsy/Pinterest adding pattern-aware visual search; SEO dependence for acquisition. Mitigate: maker relationships, exclusive metadata (construction tags), community-sewn examples.
- **Scope creep from the name:** "Lens" invites AR-measurement expectations the evidence doesn't support at MVP accuracy/cost. Mitigate: position Lens = visual pattern search, in writing, from day one.

---

## 10. Next steps

1. Steph reviews this brief and answers §8 (a 45-minute decision call; record answers back into [project_idea.md](project_idea.md) so intent stops being folklore).
2. Draft the technical architecture doc already agreed in the notes (lines 40–41) — scoped to the Phase-1 aggregator: catalog ingestion (maker feed/manual), image + metadata indexing, query flow, match-ranking evaluation harness, link-out analytics.
3. Maker outreach list + one-page pilot offer (permission, attribution, traffic reporting, zero fees in pilot); sewist interview guide built around the last failed pattern hunt.
4. Domain/trademark shortlist (already owed); decide whether SeamLens survives it.
5. Paper the deal (contract, profit definition, IP, cost responsibility) before build spend.
6. Gate the build on Phase-0 exit criteria (§6). If makers won't supply or matches don't beat manual hunting, pivot or stop cheaply.

---

## Unresolved / lower-confidence items (kept separate from the findings above)

- **Ravelry/LoveCrafts exact fees conflict across secondary sources** (Ravelry reported as both 0% and 3.5% after the first $30/mo; LoveCrafts seller fee reported as 25% vs older 5% — its official % sits in an unread image chart on the [Designer Handbook](https://www.lovecrafts.com/en-gb/pages/designer-handbook-payment-pricing-taxes) page). Do not quote either % to makers until verified on the primary fee pages.
- **Tailornova/Lekala pricing** comes via a competitor's (MPattern's) comparison pages — vendor-biased secondary evidence; verify on vendor sites before the pricing table is used externally. MPattern's own "best software" framing is likewise vendor-published.
- **Tilly and the Buttons pricing** is from a search snippet only (direct fetch returned HTTP 429). **Affiliate availability/rates** for fabric retailers (Michaels, Mood, etc.) were not researched. **B2B tailor-software pricing** surfaced only low-quality SEO pages and was excluded — B2B remains an open question, not evidence.
- **Body-scan accuracy** figures are vendor self-validated (3DLOOK explicitly notes no peer-reviewed publication); the independent study cited is from 2015 on older systems. Either way, AR measurement is outside Steph's stated idea.
- **Forum/vendor-blog pain evidence** (PatternReview threads, tailor/quilter vendor blogs) is directional, not survey-grade; the one survey (LSU 2024, n=162 via Facebook groups) covers hobbyist fit confidence only. Validate segment pains with Steph's own interviews in Phase 0.
- No credible standalone "Patternsy" sewing product was found in search; it is excluded from the competitor table pending primary evidence.

## Caveats and confidence

- **High confidence:** everything in §1 about what the workspace does and does not contain — it rests on direct, repeatedly verified inspection of the sole document and screenshot, with line-level citations.
- **Medium confidence:** the competitor/pain/monetization landscape — based on fetched vendor/help pages and identified secondary sources in late 2026; prices and fees change, and two fee conflicts above are unresolved.
- **Low confidence / recommendations, not findings:** the beachhead persona, aggregator-first phasing, and monetization sequence. They are the best-supported reading of Steph's notes plus market evidence, but Steph has not chosen them, and no user or maker has validated them. The brief's purpose is to make those choices cheap to make and cheap to test — not to have already made them.
- Web sources were used (linked throughout); no claim about Steph's intent rests on a web source, and no market claim rests on the workspace.
