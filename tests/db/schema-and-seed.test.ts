import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { toVectorLiteral, withTransaction, type Queryable } from '@/lib/db';
import {
  getCatalogMediaBucket,
  getDailyAiBudgetUsd,
  getDatabaseUrl,
} from '@/lib/env';
import { resolveCatalogMediaUrl } from '@/lib/supabase/server';
import {
  ConstructionProfileV1Schema,
  type ConstructionProfileV1,
} from '@/modules/taxonomy/construction-profile';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import {
  deterministicTextToVector768,
  seedSyntheticCatalog,
} from '../../supabase/seed/synthetic-catalog';

const migrationsDirectory = path.resolve(process.cwd(), 'supabase/migrations');
const initialMigration = fs.readFileSync(
  path.join(migrationsDirectory, '202611220001_init_seamlens_v1.sql'),
  'utf8'
);
const integrityMigration = fs.readFileSync(
  path.join(migrationsDirectory, '202611220002_catalog_integrity.sql'),
  'utf8'
);

const provenanceMigration = fs.readFileSync(path.join(migrationsDirectory, '202611220008_model_provenance.sql'), 'utf8');

const sampleQueryProfile: ConstructionProfileV1 = ConstructionProfileV1Schema.parse({
  schema_version: 1,
  garment_category: 'dress',
  substrate_compatibility: 'woven',
  silhouette: {
    overall_shape: 'fit_and_flare',
    ease_level: 'close_fitting',
    garment_length: 'midi',
  },
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
  closures_and_details: {
    primary_closure: 'invisible_zip_back',
    finish_structure: 'lined_bodice',
  },
  structural_nuance_notes: {
    bodice_neckline: 'Floral square neckline with shaped bust darts and waist seam',
    sleeves_armscye: 'Set-in puff sleeve gathered at cap and elasticized elbow cuff',
    skirt_hemline: 'Gathered midi skirt joined at natural waist with in-seam pockets',
    overall_drape_and_proportions: 'Structured woven bodice flowing into full midi skirt',
  },
});

describe('PostgreSQL + pgvector schema, publish guardrails, and synthetic seed', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = new PGlite({ extensions: { vector } });
    await pg.exec(initialMigration);
    await pg.exec(integrityMigration);
    await pg.exec(provenanceMigration);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('creates all 13 tables with RLS enabled, HNSW vector indexes, and UNLOGGED query_sessions', async () => {
    const tablesRes = await pg.query<{
      relname: string;
      relrowsecurity: boolean;
      relpersistence: string;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relpersistence
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
       ORDER BY c.relname`
    );

    const expectedTables = [
      'admin_users',
      'api_usage_ledger',
      'curated_archetypes',
      'ingestion_batches',
      'ingestion_items',
      'makers',
      'outbound_clicks',
      'pattern_size_bands',
      'pattern_views',
      'patterns',
      'query_sessions',
      'rate_limit_windows',
      'search_events',
    ];

    expect(tablesRes.rows.map((r) => r.relname)).toEqual(expectedTables);
    for (const row of tablesRes.rows) {
      expect(row.relrowsecurity).toBe(true);
    }

    const querySessionsMeta = tablesRes.rows.find((r) => r.relname === 'query_sessions');
    expect(querySessionsMeta?.relpersistence).toBe('u');

    const indexesRes = await pg.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'pattern_views'`
    );
    const hnswIndexes = indexesRes.rows.filter((r) => r.indexdef.toLowerCase().includes('using hnsw'));
    expect(hnswIndexes.length).toBe(4);
  });

  it('validates toVectorLiteral and supports atomic commit/rollback via withTransaction', async () => {
    expect(toVectorLiteral(null)).toBeNull();
    expect(() => toVectorLiteral([0.1, 0.2])).toThrow(/768/);
    expect(() => toVectorLiteral(Array.from({ length: 768 }, (_, i) => (i === 0 ? Number.NaN : 0)))).toThrow();

    const vec = deterministicTextToVector768('square neckline woven puff sleeve midi dress');
    expect(vec).toHaveLength(768);
    expect(Math.hypot(...vec)).toBeCloseTo(1.0, 5);

    const literal = toVectorLiteral(vec);
    expect(literal?.startsWith('[')).toBe(true);
    expect(literal?.endsWith(']')).toBe(true);

    await expect(
      withTransaction(pg, async (tx) => {
        await tx.query(
          `INSERT INTO rate_limit_windows (bucket, subject_hash, window_start, hit_count)
           VALUES ('query_min', 'tx_rollback_check', now(), 1)`
        );
        throw new Error('force rollback');
      })
    ).rejects.toThrow('force rollback');

    const rolledBack = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM rate_limit_windows WHERE subject_hash = 'tx_rollback_check'`
    );
    expect(Number(rolledBack.rows[0]?.count)).toBe(0);

    await withTransaction(pg, async (tx) => {
      await tx.query(
        `INSERT INTO rate_limit_windows (bucket, subject_hash, window_start, hit_count)
         VALUES ('query_min', 'tx_commit_check', now(), 2)`
      );
    });

    const committed = await pg.query<{ hit_count: number }>(
      `SELECT hit_count FROM rate_limit_windows WHERE subject_hash = 'tx_commit_check'`
    );
    expect(committed.rows[0]?.hit_count).toBe(2);
  });

  it.each(['pool', 'acquired client'] as const)(
    'rolls back on a pg-style %s and only releases connections acquired by withTransaction',
    async (input) => {
      let checkedOut = input === 'acquired client';
      let releases = 0;
      const client = {
        query: pg.query.bind(pg),
        async connect() {
          throw new Error('cannot reconnect an acquired client');
        },
        release() {
          if (!checkedOut) throw new Error('double release');
          checkedOut = false;
          releases += 1;
        },
      };
      const pool: Queryable & { connect(): Promise<typeof client> } = {
        async query() {
          throw new Error('transaction queries must use the acquired client');
        },
        async connect() {
          if (checkedOut) throw new Error('connection already acquired');
          checkedOut = true;
          return client;
        },
      };
      const db = input === 'pool' ? pool : client;
      const failure = new Error('force rollback on pg-style connection');
      await expect(withTransaction(db, async (tx) => {
        await tx.query(
          `INSERT INTO rate_limit_windows (bucket, subject_hash, window_start)
           VALUES ('query_min', $1, now())`, [input]
        );
        throw failure;
      })).rejects.toBe(failure);

      const rolledBack = await pg.query(
        'SELECT hit_count FROM rate_limit_windows WHERE subject_hash = $1', [input]
      );
      expect(rolledBack.rows).toEqual([]);
      expect(releases).toBe(input === 'pool' ? 1 : 0);
      expect(checkedOut).toBe(input === 'acquired client');
      if (input === 'acquired client') client.release();
    }
  );

  it('seeds >=20 Dress/Top views, Straight+Curve split bands, nullable-hip cropped top, and >=4 archetypes idempotently', async () => {
    const counts = await seedSyntheticCatalog(pg);
    expect(counts.makerCount).toBe(6);
    expect(counts.patternCount).toBe(18);
    expect(counts.viewCount).toBeGreaterThanOrEqual(20);
    expect(counts.archetypeCount).toBeGreaterThanOrEqual(4);

    // Re-running seed must be idempotent
    const secondCounts = await seedSyntheticCatalog(pg);
    expect(secondCounts).toEqual(counts);

    // Straight (32-46) + Curve (44-62) split bands exist on a single pattern
    const multiBandPattern = await pg.query<{ pattern_id: string; band_count: string }>(
      `SELECT p.id AS pattern_id, COUNT(psb.id)::text AS band_count
       FROM patterns p
       JOIN pattern_size_bands psb ON psb.pattern_id = p.id
       GROUP BY p.id, p.slug
       HAVING COUNT(psb.id) >= 2
       ORDER BY p.slug DESC`
    );
    expect(multiBandPattern.rows.length).toBeGreaterThanOrEqual(2);

    const soleneBandsRes = await pg.query<{
      band_label: string;
      bust_min_in: string;
      bust_max_in: string;
    }>(
      `SELECT psb.band_label, psb.bust_min_in::text, psb.bust_max_in::text
       FROM pattern_size_bands psb
       JOIN patterns p ON p.id = psb.pattern_id
       WHERE p.slug = 'solene-square-puff-midi-dress'
       ORDER BY psb.bust_min_in ASC`
    );
    expect(soleneBandsRes.rows).toHaveLength(2);
    expect(Number(soleneBandsRes.rows[0]?.bust_min_in)).toBe(32);
    expect(Number(soleneBandsRes.rows[0]?.bust_max_in)).toBe(46);
    expect(Number(soleneBandsRes.rows[1]?.bust_min_in)).toBe(44);
    expect(Number(soleneBandsRes.rows[1]?.bust_max_in)).toBe(62);

    // Nullable-hip cropped top with NULL vec_skirt
    const croppedTop = await pg.query<{ slug: string; hip_min_in: string | null; vec_skirt: string | null }>(
      `SELECT p.slug, psb.hip_min_in::text, pv.vec_skirt::text
       FROM patterns p
       JOIN pattern_size_bands psb ON psb.pattern_id = p.id
       JOIN pattern_views pv ON pv.pattern_id = p.id
       WHERE p.garment_category = 'top' AND psb.hip_min_in IS NULL`
    );
    expect(croppedTop.rows.length).toBeGreaterThanOrEqual(1);
    expect(croppedTop.rows[0]?.vec_skirt).toBeNull();
  });

  it('orders seeded pattern_views by pgvector <=> cosine similarity and supports UNLOGGED query_sessions insertion', async () => {
    const canonical = serializeCanonicalRegions(sampleQueryProfile);
    const vecFull = deterministicTextToVector768(canonical.full_silhouette);
    const vecBodice = deterministicTextToVector768(canonical.bodice_neckline);
    const vecSleeves = deterministicTextToVector768(canonical.sleeves_armscye);
    const vecSkirt = canonical.skirt_hemline
      ? deterministicTextToVector768(canonical.skirt_hemline)
      : null;

    const insertedSession = await pg.query<{ id: string }>(
      `INSERT INTO query_sessions (
        image_sha256,
        query_status,
        extracted_profile,
        canonical_texts,
        vec_full,
        vec_bodice,
        vec_sleeves,
        vec_skirt
      ) VALUES ($1, 'ok', $2::jsonb, $3::jsonb, $4::vector, $5::vector, $6::vector, $7::vector)
      RETURNING id`,
      [
        'abc123sha256test',
        JSON.stringify(sampleQueryProfile),
        JSON.stringify(canonical),
        toVectorLiteral(vecFull),
        toVectorLiteral(vecBodice),
        toVectorLiteral(vecSleeves),
        toVectorLiteral(vecSkirt),
      ]
    );
    expect(insertedSession.rows[0]?.id).toBeTruthy();

    const ranked = await pg.query<{
      slug: string;
      view_code: string;
      cosine_sim: number;
    }>(
      `SELECT
         p.slug,
         pv.view_code,
         (1 - (pv.vec_full <=> qs.vec_full))::float8 AS cosine_sim
       FROM pattern_views pv
       JOIN patterns p ON p.id = pv.pattern_id
       JOIN makers m ON m.id = p.maker_id
       JOIN query_sessions qs ON qs.id = $1
       WHERE p.status = 'published' AND m.vetted_status = 'approved'
       ORDER BY pv.vec_full <=> qs.vec_full ASC
       LIMIT 5`,
      [insertedSession.rows[0].id]
    );

    expect(ranked.rows.length).toBe(5);
    expect(ranked.rows[0]?.cosine_sim).toBeGreaterThan(ranked.rows[4]?.cosine_sim ?? 0);
    // Square-neck puff-sleeve woven midi dress must rank ahead of floral t-shirt decoy
    const topSlugs = ranked.rows.slice(0, 3).map((r) => r.slug);
    expect(topSlugs).not.toContain('meadow-floral-crew-tee');
    expect(ranked.rows[0]?.slug).toBe('solene-square-puff-midi-dress');
  });

  it('enforces all publish-readiness trigger cases (unapproved maker, dress missing hip, 0 views rejected; cropped top nullable-hip allowed)', async () => {
    const sampleVec = toVectorLiteral(deterministicTextToVector768('sample garment construction'));
    const canonical = serializeCanonicalRegions(sampleQueryProfile);

    // Setup pending maker and approved maker
    const pendingMakerRes = await pg.query<{ id: string }>(
      `INSERT INTO makers (slug, name, storefront_url, platform_type, vetted_status)
       VALUES ('pending-test-maker', 'Pending Maker', 'https://pending.example', 'shopify', 'pending')
       RETURNING id`
    );
    const pendingMakerId = pendingMakerRes.rows[0].id;

    const approvedMakerRes = await pg.query<{ id: string }>(
      `INSERT INTO makers (slug, name, storefront_url, platform_type, vetted_status)
       VALUES ('approved-test-maker', 'Approved Test Maker', 'https://approved.example', 'shopify', 'approved')
       RETURNING id`
    );
    const approvedMakerId = approvedMakerRes.rows[0].id;

    // 1. Pending maker with valid band + valid view -> UPDATE to published must reject
    const unapprovedPatternRes = await pg.query<{ id: string }>(
      `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
       VALUES ($1, 'unapproved-maker-test-dress', 'Unapproved Dress', 'dress', 'woven', ARRAY['pdf_a4_letter'], 'intermediate', 'draft')
       RETURNING id`,
      [pendingMakerId]
    );
    const unapprovedPatternId = unapprovedPatternRes.rows[0].id;

    await pg.query(
      `INSERT INTO pattern_size_bands (pattern_id, maker_id, band_label, product_url, bust_min_in, bust_max_in, hip_min_in, hip_max_in)
       VALUES ($1, $2, 'Standard', 'https://pending.example/dress', 32.0, 48.0, 34.0, 50.0)`,
      [unapprovedPatternId, pendingMakerId]
    );
    await pg.query(
      `INSERT INTO pattern_views (pattern_id, view_code, view_label, garment_category, cover_image_path, construction_profile, canonical_texts, vec_full, vec_bodice, vec_sleeves, vec_skirt)
       VALUES ($1, 'view_a', 'View A', 'dress', 'catalog-media/pending/cover.webp', $2::jsonb, $3::jsonb, $4::vector, $4::vector, $4::vector, $4::vector)`,
      [unapprovedPatternId, JSON.stringify(sampleQueryProfile), JSON.stringify(canonical), sampleVec]
    );

    await expect(
      pg.query(`UPDATE patterns SET status = 'published' WHERE slug = 'unapproved-maker-test-dress'`)
    ).rejects.toThrow(/maker.*approved/i);

    // 2. Approved maker, Dress with hip_min_in = NULL -> UPDATE to published must reject
    const dressMissingHipRes = await pg.query<{ id: string }>(
      `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
       VALUES ($1, 'missing-hip-test-dress', 'Missing Hip Dress', 'dress', 'woven', ARRAY['pdf_a4_letter'], 'intermediate', 'draft')
       RETURNING id`,
      [approvedMakerId]
    );
    const dressMissingHipId = dressMissingHipRes.rows[0].id;

    await pg.query(
      `INSERT INTO pattern_size_bands (pattern_id, maker_id, band_label, product_url, bust_min_in, bust_max_in, hip_min_in, hip_max_in)
       VALUES ($1, $2, 'Standard', 'https://approved.example/missing-hip', 32.0, 48.0, NULL, NULL)`,
      [dressMissingHipId, approvedMakerId]
    );
    await pg.query(
      `INSERT INTO pattern_views (pattern_id, view_code, view_label, garment_category, cover_image_path, construction_profile, canonical_texts, vec_full, vec_bodice, vec_sleeves, vec_skirt)
       VALUES ($1, 'view_a', 'View A', 'dress', 'catalog-media/approved/cover.webp', $2::jsonb, $3::jsonb, $4::vector, $4::vector, $4::vector, $4::vector)`,
      [dressMissingHipId, JSON.stringify(sampleQueryProfile), JSON.stringify(canonical), sampleVec]
    );

    await expect(
      pg.query(`UPDATE patterns SET status = 'published' WHERE slug = 'missing-hip-test-dress'`)
    ).rejects.toThrow(/hip|size_bands/i);

    // 3. Approved maker, Dress with valid size band but 0 pattern_views -> UPDATE to published must reject
    const noViewsDressRes = await pg.query<{ id: string }>(
      `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
       VALUES ($1, 'no-views-test-dress', 'No Views Dress', 'dress', 'woven', ARRAY['pdf_a4_letter'], 'intermediate', 'draft')
       RETURNING id`,
      [approvedMakerId]
    );
    const noViewsDressId = noViewsDressRes.rows[0].id;

    await pg.query(
      `INSERT INTO pattern_size_bands (pattern_id, maker_id, band_label, product_url, bust_min_in, bust_max_in, hip_min_in, hip_max_in)
       VALUES ($1, $2, 'Standard', 'https://approved.example/no-views', 32.0, 48.0, 34.0, 50.0)`,
      [noViewsDressId, approvedMakerId]
    );

    await expect(
      pg.query(`UPDATE patterns SET status = 'published' WHERE slug = 'no-views-test-dress'`)
    ).rejects.toThrow(/pattern_views|view/i);

    // 4. Approved maker, Cropped Top (garment_category = 'top') with hip_min_in = NULL and valid bust bounds + view -> SUCCEEDS
    const topProfile: ConstructionProfileV1 = {
      ...sampleQueryProfile,
      garment_category: 'top',
      silhouette: { overall_shape: 'boxy_cropped', ease_level: 'semi_fitted', garment_length: 'cropped' },
      skirt_and_hemline: {
        ...sampleQueryProfile.skirt_and_hemline,
        has_skirt_section: false,
        skirt_construction: 'none_top_hem',
        tier_count: 0,
      },
    };
    const topCanonical = serializeCanonicalRegions(topProfile);

    const croppedTopRes = await pg.query<{ id: string }>(
      `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
       VALUES ($1, 'cropped-top-nullable-hip-test', 'Cropped Nullable Hip Top', 'top', 'woven', ARRAY['pdf_a4_letter'], 'confident_beginner', 'draft')
       RETURNING id`,
      [approvedMakerId]
    );
    const croppedTopId = croppedTopRes.rows[0].id;

    await pg.query(
      `INSERT INTO pattern_size_bands (pattern_id, maker_id, band_label, product_url, bust_min_in, bust_max_in, hip_min_in, hip_max_in)
       VALUES ($1, $2, 'Standard', 'https://approved.example/cropped-top', 32.0, 56.0, NULL, NULL)`,
      [croppedTopId, approvedMakerId]
    );
    await pg.query(
      `INSERT INTO pattern_views (pattern_id, view_code, view_label, garment_category, cover_image_path, construction_profile, canonical_texts, vec_full, vec_bodice, vec_sleeves, vec_skirt)
       VALUES ($1, 'view_a', 'View A', 'top', 'catalog-media/approved/cropped-top.webp', $2::jsonb, $3::jsonb, $4::vector, $4::vector, $4::vector, NULL)`,
      [croppedTopId, JSON.stringify(topProfile), JSON.stringify(topCanonical), sampleVec]
    );

    const publishTopRes = await pg.query<{ status: string; published_at: string | null }>(
      `UPDATE patterns SET status = 'published' WHERE slug = 'cropped-top-nullable-hip-test' RETURNING status, published_at::text`
    );
    expect(publishTopRes.rows[0]?.status).toBe('published');
    expect(publishTopRes.rows[0]?.published_at).toBeTruthy();

    // 5. Direct INSERT with status = 'published' (no child rows yet) is also blocked
    await expect(
      pg.query(
        `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
         VALUES ($1, 'direct-publish-blocked', 'Direct Publish', 'dress', 'woven', ARRAY['pdf_a4_letter'], 'intermediate', 'published')`,
        [approvedMakerId]
      )
    ).rejects.toThrow(/pattern_size_bands|hip|size_bands/i);
  });

  it('rejects mismatched maker ownership when inserting or updating a size band', async () => {
    await pg.exec(`
      INSERT INTO makers (slug, name, storefront_url, platform_type)
      VALUES ('band-owner', 'Band Owner', 'https://owner.example', 'custom'),
             ('unrelated-owner', 'Other Owner', 'https://other.example', 'custom');
      INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, skill_level)
      SELECT id, 'band-owner-top', 'Band Owner Top', 'top', 'woven', 'intermediate'
      FROM makers WHERE slug = 'band-owner';
      INSERT INTO pattern_size_bands (pattern_id, maker_id, product_url, bust_min_in, bust_max_in)
      SELECT id, maker_id, 'https://owner.example/top', 32, 48
      FROM patterns WHERE slug = 'band-owner-top';
    `);

    await expect(pg.query(`
      INSERT INTO pattern_size_bands (pattern_id, maker_id, band_label, product_url, bust_min_in, bust_max_in)
      SELECT p.id, m.id, 'Curve', 'https://other.example/top', 42, 58
      FROM patterns p CROSS JOIN makers m
      WHERE p.slug = 'band-owner-top' AND m.slug = 'unrelated-owner'
    `)).rejects.toMatchObject({ code: '23503' });

    await expect(pg.query(`
      UPDATE pattern_size_bands
      SET maker_id = (SELECT id FROM makers WHERE slug = 'unrelated-owner')
      WHERE pattern_id = (SELECT id FROM patterns WHERE slug = 'band-owner-top')
    `)).rejects.toMatchObject({ code: '23503' });

    await expect(pg.query(`
      UPDATE patterns
      SET maker_id = (SELECT id FROM makers WHERE slug = 'unrelated-owner')
      WHERE slug = 'band-owner-top'
    `)).rejects.toMatchObject({ code: '23503' });
  });

  it('requires approved makers on import creation and reassignment', async () => {
    await pg.exec(`
      INSERT INTO makers (slug, name, storefront_url, platform_type, vetted_status)
      VALUES ('import-pending', 'Pending', 'https://pending.example', 'custom', 'pending'),
             ('import-suspended', 'Suspended', 'https://suspended.example', 'custom', 'suspended'),
             ('import-approved', 'Approved', 'https://approved.example', 'custom', 'approved');
    `);

    const enqueueSql = `
      INSERT INTO ingestion_batches (maker_id, source_type, source_descriptor, created_by)
      SELECT id, 'csv_upload', 'test.csv', gen_random_uuid() FROM makers WHERE slug = $1
      RETURNING id
    `;
    for (const slug of ['import-pending', 'import-suspended']) {
      await expect(pg.query(enqueueSql, [slug])).rejects.toThrow(/maker.*approved/i);
    }

    const { rows: [batch] } = await pg.query<{ id: string }>(enqueueSql, ['import-approved']);
    for (const slug of ['import-pending', 'import-suspended']) {
      await expect(pg.query(`
        UPDATE ingestion_batches SET maker_id = (SELECT id FROM makers WHERE slug = $1)
        WHERE id = $2
      `, [slug, batch.id])).rejects.toThrow(/maker.*approved/i);
    }

    await pg.query(`UPDATE makers SET vetted_status = 'suspended' WHERE slug = 'import-approved'`);
    const result = await pg.query<{ status: string }>(
      `UPDATE ingestion_batches SET status = 'failed' WHERE id = $1 RETURNING status`, [batch.id]
    );
    expect(result.rows).toEqual([{ status: 'failed' }]);
  });

  it('reports legacy ownership mismatches and preserves ownership for manual correction', async () => {
    const legacyPg = new PGlite({ extensions: { vector } });
    try {
      await legacyPg.exec(initialMigration);
      await legacyPg.exec(`
        INSERT INTO makers (id, slug, name, storefront_url, platform_type)
        VALUES ('10000000-0000-0000-0000-000000000001', 'legacy-owner', 'Legacy Owner', 'https://owner.example', 'custom'),
               ('10000000-0000-0000-0000-000000000002', 'legacy-other', 'Other Maker', 'https://other.example', 'custom');
        INSERT INTO patterns (id, maker_id, slug, title, garment_category, substrate_type, skill_level)
        VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
                'legacy-top', 'Legacy Top', 'top', 'woven', 'intermediate');
        INSERT INTO pattern_size_bands (id, pattern_id, maker_id, product_url, bust_min_in, bust_max_in)
        VALUES ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                '10000000-0000-0000-0000-000000000002', 'https://other.example/top', 32, 48);
      `);
      await expect(legacyPg.exec(integrityMigration)).rejects.toMatchObject({
        message: expect.stringMatching(/legacy.*ownership/i),
        detail: expect.stringContaining('30000000-0000-0000-0000-000000000001'),
        hint: expect.stringMatching(/correct/i),
      });
      const legacyBand = await legacyPg.query<{ maker_id: string }>('SELECT maker_id FROM pattern_size_bands');
      expect(legacyBand.rows).toEqual([{ maker_id: '10000000-0000-0000-0000-000000000002' }]);

      await legacyPg.query(`
        UPDATE pattern_size_bands b SET maker_id = p.maker_id FROM patterns p WHERE b.pattern_id = p.id
      `);
      await legacyPg.exec(integrityMigration);
      const correctedBand = await legacyPg.query<{ maker_id: string }>('SELECT maker_id FROM pattern_size_bands');
      expect(correctedBand.rows).toEqual([{ maker_id: '10000000-0000-0000-0000-000000000001' }]);
    } finally {
      await legacyPg.close();
    }
  });

  it('executes and enforces Supabase anon and authenticated RLS policies when roles exist', async () => {
    const rlsPg = new PGlite({ extensions: { vector } });
    await rlsPg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO anon, authenticated, service_role, PUBLIC;
    `);
    await rlsPg.exec(initialMigration);
    await rlsPg.exec(provenanceMigration);

    const counts = await seedSyntheticCatalog(rlsPg);
    expect(counts.patternCount).toBe(18);

    // Insert a pending maker, a draft pattern, and an inactive archetype
    await rlsPg.query(
      `INSERT INTO makers (slug, name, storefront_url, platform_type, vetted_status)
       VALUES ('hidden-pending-maker', 'Hidden Pending', 'https://hidden.example', 'shopify', 'pending')`
    );
    await rlsPg.query(
      `INSERT INTO patterns (maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status)
       SELECT id, 'hidden-draft-dress', 'Hidden Draft', 'dress', 'woven', ARRAY['pdf_a4_letter'], 'intermediate', 'draft'
       FROM makers WHERE slug = 'maison-verveine'`
    );
    await rlsPg.query(
      `INSERT INTO curated_archetypes (
        slug, title, caption, image_path, extracted_profile, vec_full, vec_bodice, vec_sleeves, active
      )
      SELECT 'inactive-archetype', 'Hidden', 'Hidden', 'catalog-media/x.webp', extracted_profile, vec_full, vec_bodice, vec_sleeves, false
      FROM curated_archetypes LIMIT 1`
    );

    await rlsPg.exec(`
      GRANT SELECT (permission_evidence_note) ON makers TO anon, authenticated, PUBLIC;
      UPDATE makers SET permission_evidence_note = 'Private permission record' WHERE slug = 'maison-verveine';
    `);
    await rlsPg.exec(integrityMigration);

    const owner = await rlsPg.query<{ id: string }>(`SELECT id FROM makers WHERE slug = 'maison-verveine'`);
    const makerId = owner.rows[0].id;
    const published = await rlsPg.query<{ ids: string[] }>(
      `SELECT array_agg(id) AS ids FROM patterns WHERE maker_id = $1 AND status = 'published'`, [makerId]
    );
    const patternIds = published.rows[0].ids;
    const visibleMakerCatalog = (role: 'anon' | 'authenticated') => withTransaction(rlsPg, async (tx) => {
      await tx.query(`SET LOCAL ROLE ${role}`);
      const result = await tx.query<{ makers: number; patterns: number; bands: number; views: number }>(`
        SELECT (SELECT COUNT(*)::int FROM makers WHERE id = $1) AS makers,
               (SELECT COUNT(*)::int FROM patterns WHERE id = ANY($2::uuid[])) AS patterns,
               (SELECT COUNT(*)::int FROM pattern_size_bands WHERE pattern_id = ANY($2::uuid[])) AS bands,
               (SELECT COUNT(*)::int FROM pattern_views WHERE pattern_id = ANY($2::uuid[])) AS views
      `, [makerId, patternIds]);
      return result.rows[0];
    });

    for (const roleName of ['anon', 'authenticated'] as const) {
      const visibleCounts = await withTransaction(rlsPg, async (tx) => {
        await tx.query(`SET LOCAL ROLE ${roleName}`);
        const visibleMakers = await tx.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM makers`
        );
        const visiblePatterns = await tx.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM patterns`
        );
        const visibleArchetypes = await tx.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM curated_archetypes`
        );
        return {
          makers: Number(visibleMakers.rows[0].count),
          patterns: Number(visiblePatterns.rows[0].count),
          archetypes: Number(visibleArchetypes.rows[0].count),
        };
      });
      expect(visibleCounts).toEqual({ makers: 6, patterns: 18, archetypes: 4 });

      const ownerCatalog = await visibleMakerCatalog(roleName);
      expect(ownerCatalog.makers).toBe(1);
      expect(ownerCatalog.patterns).toBeGreaterThan(0);
      expect(ownerCatalog.bands).toBeGreaterThan(0);
      expect(ownerCatalog.views).toBeGreaterThan(0);

      await expect(withTransaction(rlsPg, async (tx) => {
        await tx.query(`SET LOCAL ROLE ${roleName}`);
        return tx.query(`SELECT permission_evidence_note FROM makers`);
      })).rejects.toMatchObject({ code: '42501' });

      const grants = await rlsPg.query<{ accessible: string[] }>(`
        SELECT ARRAY(
          SELECT relname FROM pg_class
          WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
            AND has_table_privilege($1, oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          ORDER BY relname
        ) AS accessible
      `, [roleName]);
      expect(grants.rows[0].accessible).toEqual([]);

      await expect(
        withTransaction(rlsPg, async (tx) => {
          await tx.query(`SET LOCAL ROLE ${roleName}`);
          return tx.query(`SELECT COUNT(*) FROM query_sessions`);
        })
      ).rejects.toThrow(/permission/i);

      await expect(
        withTransaction(rlsPg, async (tx) => {
          await tx.query(`SET LOCAL ROLE ${roleName}`);
          return tx.query(`SELECT COUNT(*) FROM admin_users`);
        })
      ).rejects.toThrow(/permission/i);
    }

    await rlsPg.query(`UPDATE makers SET vetted_status = 'suspended' WHERE slug = 'maison-verveine'`);
    for (const roleName of ['anon', 'authenticated'] as const) {
      expect(await visibleMakerCatalog(roleName)).toEqual({ makers: 0, patterns: 0, bands: 0, views: 0 });
    }

    const serviceRows = await withTransaction(rlsPg, async (tx) => {
      await tx.query('SET LOCAL ROLE service_role');
      return tx.query<{ permission_evidence_note: string }>(
        `SELECT permission_evidence_note FROM makers WHERE slug = 'maison-verveine'`
      );
    });
    expect(serviceRows.rows).toEqual([{ permission_evidence_note: 'Private permission record' }]);
    await rlsPg.close();
  });

  it('exposes lazy env defaults and Storage URL resolution without requiring live secrets at import time', () => {
    const prevBudget = process.env.DAILY_AI_BUDGET_USD;
    const prevDbUrl = process.env.DATABASE_URL;
    const prevSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    try {
      delete process.env.DAILY_AI_BUDGET_USD;
      delete process.env.DATABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;

      expect(getDailyAiBudgetUsd()).toBe(10);
      expect(getCatalogMediaBucket()).toBe('catalog-media');
      expect(() => getDatabaseUrl()).toThrow(/DATABASE_URL/);
      expect(resolveCatalogMediaUrl(null)).toBeNull();
      expect(resolveCatalogMediaUrl('catalog-media/maison/solene.webp')).toBe(
        '/catalog-media/maison/solene.webp'
      );

      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://demo.supabase.co/';
      expect(resolveCatalogMediaUrl('catalog-media/maison/solene.webp')).toBe(
        'https://demo.supabase.co/storage/v1/object/public/catalog-media/maison/solene.webp'
      );
    } finally {
      if (prevBudget === undefined) delete process.env.DAILY_AI_BUDGET_USD;
      else process.env.DAILY_AI_BUDGET_USD = prevBudget;

      if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDbUrl;

      if (prevSupabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = prevSupabaseUrl;
    }
  });
});
