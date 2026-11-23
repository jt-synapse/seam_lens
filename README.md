# SeamLens Studio

SeamLens matches a garment photo to sewing patterns from approved makers using construction details such as neckline, sleeve and silhouette. Start at `/` with a garment photo, direct image URL or sample silhouette. At `/search`, refine matches by garment part, measurements, fabric, format and skill level. Curators manage the catalog at `/admin`. The remaining implementation task is the benchmark and staging release check. [Implementation checklist](docs/superpowers/plans/2026-11-22-seamlens-studio-v1.md#implementation-checklist)

## Check a fresh checkout

From the repository root, use Bun to install the locked dependencies and run the local checks. The default suite uses synthetic fixtures, PGlite and provider doubles.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test --maxWorkers=3
bun run build
```

The native PostgreSQL contention test uses `SEAMLENS_TEST_POSTGRES_URL` and creates a temporary database. The live Gemini check requires a migrated staging database, a provider key and explicit opt-in. [Staging test](tests/vision/gemini-staging.test.ts)

## Run discovery and curation

1. Configure a development Supabase project with PostgreSQL 16 and pgvector. Apply the SQL migrations in filename order, from 001 through 007. [Migrations](supabase/migrations)
2. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. Catalog media uploads use `SUPABASE_SERVICE_ROLE_KEY`. Live image analysis and re-embedding use `GEMINI_API_KEY`. Set a private `RATE_LIMIT_IP_SALT` for deployed public search. [Environment configuration](src/lib/env.ts)
3. For curator access, create an email/password user in Supabase Auth. Add that user's UUID and email to `admin_users` with the role `curator` or `engineer`.
4. Run `bun --env-file=.env.local scripts/db-seed.ts` to load the synthetic catalog into the development database. Then run `bun run dev` and try a sample silhouette from the [public discovery page](http://localhost:3000/), or sign in to the [curator workspace](http://localhost:3000/admin).

## Repository map

| Location | Contents |
| --- | --- |
| [src/app](src/app) | Public discovery, admin pages, search endpoints and tracked maker redirects |
| [src/modules](src/modules) | Taxonomy, ranking, model adapters, ingestion and curation |
| [supabase](supabase) | Ordered schema migrations and synthetic catalog seed |
| [tests](tests) | Route, domain, schema, browser-component and integration tests |
| [Technical architecture](docs/superpowers/specs/2026-11-22-seamlens-technical-architecture-design.md) | Data model, service contracts and release criteria |
