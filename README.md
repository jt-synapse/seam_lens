# SeamLens Studio

SeamLens matches a garment photo to sewing patterns from approved makers using construction details such as neckline, sleeve and silhouette. Start at `/` with a garment photo, direct image URL or sample silhouette. At `/search`, refine matches by garment part, measurements, fabric, format and skill level. Curators manage the catalog at `/admin`. The offline benchmark is available. Public release acceptance is pending the permissioned staging catalog and human-graded queries. [Implementation checklist](docs/superpowers/plans/2026-11-22-seamlens-studio-v1.md#implementation-checklist)

## Show Steph the app locally

From the checkout that contains this README, start Docker and run:

```sh
bun install --frozen-lockfile
bun run demo
```

Open the [presenter guide](http://127.0.0.1:3101/) on the same computer. It has the demo curator login, a sample photo, a direct image address and a catalog CSV. For a remote walkthrough, share the browser window. The public app and curator workspace share one temporary catalog.

1. Start in [discovery](http://localhost:3100/). Upload the guide’s sample photo or paste its sample image address. Try a part focus and size filter, inspect a technical flat, then follow the maker link to see the selected pattern and size band.
2. Open the [curator workspace](http://localhost:3100/admin). Import the sample CSV under **Maison Verveine**, open the new draft, review its construction and size band, and choose **Save & Re-Embed** and **Publish**. The guide also includes a sample Shopify workflow.
3. Search again to see the published design. Use **Takedown** to remove it, then open **Telemetry** to see searches and maker clicks from the walkthrough.

The demo runs the app’s PostgreSQL search, filters, catalog writes and click tracking. Local fixtures simulate photo analysis, embeddings, sign-in, media storage and maker storefronts. Use the sample photo to demonstrate a known match. Arbitrary photos receive a sample construction profile. The services bind to loopback. Press Ctrl+C in the launcher terminal to end the session. Each launch starts with a fresh synthetic catalog. The initial dependency install and Docker image download require internet access.

## Check a fresh checkout

From the repository root, use Bun to install the locked dependencies and run the local checks. The default suite uses synthetic fixtures, PGlite and provider doubles.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run eval:benchmark --smoke
```

The native PostgreSQL contention test uses `SEAMLENS_TEST_POSTGRES_URL` and creates a temporary database. The live Gemini check requires a migrated staging database, a provider key and explicit opt-in. [Staging test](tests/vision/gemini-staging.test.ts)

## Run discovery and curation

1. Configure a development Supabase project with PostgreSQL 16 and pgvector. Apply the SQL migrations in filename order, from 001 through 008. [Migrations](supabase/migrations)
2. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. Catalog media uploads use `SUPABASE_SERVICE_ROLE_KEY`. Live image analysis and re-embedding use `GEMINI_API_KEY`. Set a private `RATE_LIMIT_IP_SALT` for deployed public search. [Environment configuration](src/lib/env.ts)
3. For curator access, create an email/password user in Supabase Auth. Add that user's UUID and email to `admin_users` with the role `curator` or `engineer`.
4. Run `bun --env-file=.env.local scripts/db-seed.ts` to load the synthetic catalog into the development database. Then run `bun run dev` and try a sample silhouette from the [public discovery page](http://localhost:3000/), or sign in to the [curator workspace](http://localhost:3000/admin).

## Evaluate search quality

**Stage A** runs 15 independently labeled synthetic uploads against an in-memory, migrated catalog. It uses the production image normalization, session, filter and ranker code with fixture extraction and deterministic embeddings. The command above writes Markdown and JSON to `eval/reports/stage-a.*`. The JSON includes each ranked result, relevance grade and print-trap label. [Smoke manifest and label rationales](eval/fixtures/smoke-v1/manifest.json)

**Stage B** measures a deployed staging workspace in desktop Chrome. Set `SEAMLENS_STAGING_URL` and `DATABASE_URL` for the same isolated deployment. The deployed app supplies Supabase and Gemini credentials. The runner uses locally installed Chrome, or a Chromium executable specified by `SEAMLENS_CHROME_PATH`.

```sh
bun run eval:benchmark --dataset eval/benchmark-v1
```

Place permissioned photos and a `manifest.json` in that directory. Supply a `datasetId`, the human grader in `gradedBy`, and 50–100 distinct entries in `cases`. Each case uses the following shape. Label patterns by their published slugs. Grade 2 means a direct construction match and grade 1 means a match achievable with a minor alteration.

```json
{
  "id": "bodice-01",
  "description": "Square neckline with puff sleeves",
  "imagePath": "photos/bodice-01.webp",
  "focusRegion": "bodice_neckline",
  "filters": { "userBustIn": 44 },
  "relevantGrades": { "first-maker-square-bodice": 2, "second-maker-square-bodice": 1 },
  "printTrapPatternIds": ["similar-print-different-cut"]
}
```

Include all four focus regions and labeled print traps. The runner checks the database for 15–25 approved houses with recorded permission and 300–500 active views. It verifies the catalog embedding model and dimensions against each cold session. For catalog views created before migration 008, use the curator’s Save & Re-Embed action to record the model that produced their vectors. Populate the live sample gallery with query vectors from the staging embedding model.

Each photo starts in a new browser context. The runner measures from submission to painted results, then changes part focus and filters and reads the corresponding API timings. It spaces uploads to respect the 40-per-hour public limit. Run against quiet staging so other queries cannot confound model-call counts. For a repeat run, allow previous query sessions to expire. Stage B requires at least 85% Top-3 relevance, zero Top-3 print traps, cold browser p95 below 3,500 ms, and refinements below 100 ms with zero model calls. The report also shows the 80 ms API refinement target.

Both modes accept `--out DIRECTORY`. The CLI returns 0 on a passing benchmark and 1 on a failed gate or missing release evidence. A missing staging dataset produces a pending report. Hosted Auth, Storage, and the import-to-takedown acceptance flow are tracked separately. [Release checklist](docs/superpowers/plans/2026-11-22-seamlens-studio-v1.md#implementation-checklist)

## Repository map

| Location | Contents |
| --- | --- |
| [src/app](src/app) | Public discovery, admin pages, search endpoints and tracked maker redirects |
| [src/modules](src/modules) | Taxonomy, ranking, model adapters, ingestion and curation |
| [supabase](supabase) | Ordered schema migrations and synthetic catalog seed |
| [tests](tests) | Route, domain, schema, browser-component and integration tests |
| [Technical architecture](docs/superpowers/specs/2026-11-22-seamlens-technical-architecture-design.md) | Data model, service contracts and release criteria |
