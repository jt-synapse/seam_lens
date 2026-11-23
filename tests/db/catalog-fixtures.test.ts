import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import sharp from 'sharp';
import { resolveCatalogMediaUrl } from '@/lib/supabase/server';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';

const publicDirectory = path.resolve('public');
const migrationsDirectory = path.resolve('supabase/migrations');

afterEach(() => vi.unstubAllEnvs());

it('resolves legacy seed paths locally with Supabase configured and keeps maker objects in Storage', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://demo.supabase.co/');
  const legacyCover = 'catalog-media/maison-verveine/solene-square-puff-midi-dress/view_a_puff_midi-cover.webp';
  const legacyArchetype = 'catalog-media/archetypes/surplice-wrap-flutter-top.webp';
  expect(resolveCatalogMediaUrl(legacyCover)).toBe('/' + legacyCover);
  expect(resolveCatalogMediaUrl(legacyArchetype)).toBe('/' + legacyArchetype);
  expect(resolveCatalogMediaUrl('/' + legacyCover)).toBe('/' + legacyCover);

  for (const makerObject of [
    'catalog-media/real-maker/solene-square-puff-midi-dress/view_a_puff_midi-cover.webp',
    'catalog-media/maison-verveine/solene-square-puff-midi-dress/uploaded-cover.webp',
    'maker-assets/real-maker/cover.webp',
  ]) {
    expect(resolveCatalogMediaUrl(makerObject)).toBe(
      'https://demo.supabase.co/storage/v1/object/public/' + makerObject
    );
  }
});

describe('synthetic catalog fixtures', () => {
  let db: PGlite;
  let initialCounts: Awaited<ReturnType<typeof seedSyntheticCatalog>>;

  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    const migrations = await readdir(migrationsDirectory);
    for (const filename of migrations.filter((entry) => entry.endsWith('.sql')).sort()) {
      await db.exec(await readFile(path.join(migrationsDirectory, filename), 'utf8'));
    }
    initialCounts = await seedSyntheticCatalog(db);
  });

  afterAll(async () => db?.close());

  it('ships decodable WebP media for all seeded paths with distinct covers and flats', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://demo.supabase.co/');
    const { rows: views } = await db.query<{
      cover_image_path: string;
      flat_front_image_path: string | null;
      flat_back_image_path: string | null;
    }>('SELECT cover_image_path, flat_front_image_path, flat_back_image_path FROM pattern_views');
    const { rows: archetypes } = await db.query<{ image_path: string }>(
      'SELECT image_path FROM curated_archetypes'
    );

    expect(views).toHaveLength(22);
    expect(archetypes).toHaveLength(4);
    const imageGroups = [
      ...views.map(({ cover_image_path, flat_front_image_path, flat_back_image_path }) =>
        [cover_image_path, flat_front_image_path, flat_back_image_path]
          .filter((storedPath): storedPath is string => storedPath !== null)
      ),
      ...archetypes.map(({ image_path }) => [image_path]),
    ];
    const paths = imageGroups.flat();
    expect(paths).toHaveLength(68);
    expect(new Set(paths).size).toBe(68);

    for (const variants of imageGroups) {
      const rendered = [];
      for (const storedPath of variants) {
        expect(storedPath).toMatch(/^\/catalog-media\//);
        expect(resolveCatalogMediaUrl(storedPath)).toBe(storedPath);
        expect(resolveCatalogMediaUrl(storedPath.slice(1))).toBe(storedPath);
        const image = sharp(path.join(publicDirectory, storedPath));
        const { format, width, height } = await image.metadata();
        expect(format, storedPath).toBe('webp');
        expect(width, storedPath).toBeGreaterThan(0);
        expect(height, storedPath).toBeGreaterThan(0);
        // Normalize dimensions so that re-encoding or resizing a duplicate cannot pass.
        rendered.push(await image.resize(96, 96, { fit: 'fill' }).raw().toBuffer());
      }
      for (const [index, variant] of rendered.entries()) {
        expect(rendered.slice(0, index).some((earlier) => earlier.equals(variant)), variants[index])
          .toBe(false);
      }
    }
  });

  it('seeds archetypes with construction profiles that match the pictured garment', async () => {
    const { rows } = await db.query<{
      slug: string;
      extracted_profile: ConstructionProfileV1;
      has_skirt_vector: boolean;
    }>('SELECT slug, extracted_profile, vec_skirt IS NOT NULL AS has_skirt_vector FROM curated_archetypes');
    const actual = Object.fromEntries(rows.map(({ slug, extracted_profile: profile, has_skirt_vector }) => [
      slug,
      [
        profile.garment_category,
        profile.bodice_and_neckline.neckline_type,
        profile.sleeves_and_armscye.sleeve_style,
        profile.silhouette.garment_length,
        profile.skirt_and_hemline.has_skirt_section,
        has_skirt_vector,
      ],
    ]));
    expect(actual).toEqual({
      'square-neck-puff-midi': ['dress', 'square', 'puff_gathered_cap', 'midi', true, true],
      'bias-cut-cowl-slip': ['dress', 'cowl', 'spaghetti_camisole', 'midi', true, true],
      'collared-button-shirtdress': ['dress', 'collared_shirt', 'fitted_straight', 'midi', true, true],
      'surplice-wrap-flutter-top': ['top', 'surplice_wrap', 'flutter_bell', 'hip_length', false, false],
    });
  });

  it('keeps fixture IDs, publication dates, suspensions and takedowns while refreshing legacy media paths', async () => {
    await db.exec(`
      UPDATE makers SET vetted_status = 'suspended' WHERE slug = 'maison-verveine';
      UPDATE makers SET vetted_status = 'pending' WHERE slug = 'atelier-sorel';
      UPDATE patterns SET status = 'takedown' WHERE slug = 'cora-tiered-smock-dress';
      UPDATE patterns SET status = 'unpublished' WHERE slug = 'meadow-floral-crew-tee';
      UPDATE patterns SET status = 'draft' WHERE slug = 'brier-plaid-camp-shirt';
      UPDATE pattern_views
        SET cover_image_path = ltrim(cover_image_path, '/'),
            flat_front_image_path = ltrim(flat_front_image_path, '/'),
            flat_back_image_path = ltrim(flat_back_image_path, '/');
      UPDATE curated_archetypes SET image_path = ltrim(image_path, '/');
    `);

    const snapshot = async () => ({
      makers: (await db.query('SELECT id, slug, vetted_status FROM makers ORDER BY slug')).rows,
      patterns: (await db.query('SELECT id, slug, status, published_at FROM patterns ORDER BY slug')).rows,
      bands: (await db.query('SELECT id FROM pattern_size_bands ORDER BY id')).rows,
      views: (await db.query('SELECT id FROM pattern_views ORDER BY id')).rows,
      archetypes: (await db.query('SELECT id FROM curated_archetypes ORDER BY id')).rows,
    });
    const before = await snapshot();

    expect(await seedSyntheticCatalog(db)).toEqual(initialCounts);
    expect(await snapshot()).toEqual(before);
    const legacyMedia = await db.query(`
      SELECT cover_image_path FROM pattern_views
      WHERE cover_image_path NOT LIKE '/%' OR flat_front_image_path NOT LIKE '/%' OR flat_back_image_path NOT LIKE '/%'
      UNION ALL
      SELECT image_path FROM curated_archetypes WHERE image_path NOT LIKE '/%'
    `);
    expect(legacyMedia.rows).toEqual([]);
  });
});
