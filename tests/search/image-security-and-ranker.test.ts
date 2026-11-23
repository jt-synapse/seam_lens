import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyzeAndSearch, type AnalyzeDeps } from '@/modules/search/analyze-service';
import { executeLoggedSessionSearch, executeSessionSearch } from '@/modules/search/hybrid-ranker';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import type { VisionExtractionResult } from '@/modules/vision/types';
import { deterministicTextToVector768, seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';

describe('image analysis and real pgvector hybrid ranking', () => {
  let db: PGlite;
  let dress: ConstructionProfileV1;
  let top: ConstructionProfileV1;
  let image: Buffer;
  let sessionId: string;
  let bandId: string;
  let flagshipId: string;
  let topId: string;
  let decoyId: string;

  function fixtures(status: VisionExtractionResult['status'], profile: ConstructionProfileV1 | null) {
    const extract = vi.fn<AnalyzeDeps['visionExtractor']['extract']>().mockResolvedValue({
      status, profile, modelId: 'test-vision', aiConfidence: 0.9, warnings: [], inputTokens: 1, outputTokens: 1,
    });
    const embedRegions = vi.fn<AnalyzeDeps['textEmbedder']['embedRegions']>().mockImplementation(async (texts) => ({
      modelId: 'test-query', inputTokens: 1,
      vectors: {
        full: deterministicTextToVector768(texts.full_silhouette),
        bodice: deterministicTextToVector768(texts.bodice_neckline),
        sleeves: deterministicTextToVector768(texts.sleeves_armscye),
        skirt: texts.skirt_hemline ? deterministicTextToVector768(texts.skirt_hemline) : null,
      },
    }));
    return { db, visionExtractor: { extract }, textEmbedder: { embedRegions } };
  }

  const upload = () => ({
    source: 'upload' as const, bytes: image, focusRegion: 'full_silhouette' as const, filters: {},
  });

  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    for (const file of ['202611220001_init_seamlens_v1.sql', '202611220002_catalog_integrity.sql', '202611220007_search_session_crop.sql', '202611220008_model_provenance.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await seedSyntheticCatalog(db);
    const seeded = await db.query<{ slug: string; id: string; construction_profile: ConstructionProfileV1 }>(
      `SELECT p.slug, p.id, v.construction_profile FROM patterns p
       JOIN pattern_views v ON v.pattern_id = p.id
       WHERE v.is_primary_view AND p.slug = ANY($1::text[])`,
      [['solene-square-puff-midi-dress', 'linden-cropped-square-blouse', 'meadow-floral-crew-tee']],
    );
    const flagship = seeded.rows.find(({ slug }) => slug === 'solene-square-puff-midi-dress')!;
    const croppedTop = seeded.rows.find(({ slug }) => slug === 'linden-cropped-square-blouse')!;
    flagshipId = flagship.id;
    dress = flagship.construction_profile;
    topId = croppedTop.id;
    top = croppedTop.construction_profile;
    decoyId = seeded.rows.find(({ slug }) => slug === 'meadow-floral-crew-tee')!.id;
    bandId = (await db.query<{ id: string }>(
      'SELECT id FROM pattern_size_bands WHERE pattern_id = $1 AND NOT is_default', [flagshipId],
    )).rows[0].id;
    image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#bed' } }).png().toBuffer();
    const { rows: [session] } = await db.query<{ id: string }>(
      `INSERT INTO query_sessions (image_sha256, query_status, extracted_profile, canonical_texts,
                                   vec_full, vec_bodice, vec_sleeves, vec_skirt)
       SELECT 'fixture-dress', 'ok', extracted_profile, '{}', vec_full, vec_bodice, vec_sleeves, vec_skirt
       FROM curated_archetypes WHERE slug = 'square-neck-puff-midi'
       RETURNING id`,
    );
    sessionId = session.id;
  });

  afterAll(async () => db?.close());

  it('ranks the square-neck dress first, deduplicates its views, and logs successful analyses including cache hits', async () => {
    const deps = fixtures('ok', dress);
    const first = await analyzeAndSearch(deps, upload());
    expect((await db.query('SELECT vision_model, embedding_model FROM query_sessions WHERE id=$1',
      [first.querySessionId])).rows).toEqual([{ vision_model: 'test-vision', embedding_model: 'test-query' }]);
    expect(first.results[0]).toMatchObject({ patternId: flagshipId, bustRangeIn: [32, 62] });
    expect(first.results[0].secondaryViewCount).toBeGreaterThanOrEqual(1);
    expect(first.results.slice(0, 3).map(({ patternId }) => patternId)).not.toContain(decoyId);
    expect(new Set(first.results.map(({ patternId }) => patternId)).size).toBe(first.results.length);

    deps.visionExtractor.extract.mockRejectedValue(new Error('Budget exhausted'));
    deps.textEmbedder.embedRegions.mockRejectedValue(new Error('Budget exhausted'));
    expect(await analyzeAndSearch(deps, upload())).toEqual(first);
    expect(deps.visionExtractor.extract).toHaveBeenCalledTimes(1);
    expect(deps.textEmbedder.embedRegions).toHaveBeenCalledTimes(1);
    const events = await db.query('SELECT source_type FROM search_events WHERE query_session_id = $1', [first.querySessionId]);
    expect(events.rows).toEqual([{ source_type: 'upload' }, { source_type: 'upload' }]);
  });

  it('includes both categories on bodice focus and selects a qualifying band while displaying union ranges', async () => {
    const result = await executeLoggedSessionSearch(db, sessionId, 'bodice_neckline',
      { userBustIn: 52, userHipIn: 56 }, 'filter_refinement');
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ patternId: flagshipId, garmentCategory: 'dress', matchedSizeBandId: bandId, bustRangeIn: [32, 62] }),
      expect.objectContaining({ patternId: topId, garmentCategory: 'top', hipRangeIn: [null, null] }),
    ]));
    const events = await db.query(
      "SELECT source_type FROM search_events WHERE query_session_id = $1 AND source_type = 'filter_refinement'", [sessionId],
    );
    expect(events.rows).toEqual([{ source_type: 'filter_refinement' }]);
  });

  it('requires bust and hip to fit the same band and computes positive single-facet relaxations', async () => {
    const split = await executeSessionSearch(db, sessionId, 'full_silhouette', { userBustIn: 34, userHipIn: 56 });
    expect(split.results.map(({ patternId }) => patternId)).not.toContain(flagshipId);
    const strict = await executeSessionSearch(db, sessionId, 'full_silhouette',
      { formats: ['projector'], skills: ['advanced_couture'] });
    expect(strict.results).toEqual([]);
    expect(strict.relaxationHints).toEqual(expect.arrayContaining([
      expect.objectContaining({ facet: 'skills', resultCount: expect.any(Number) }),
    ]));
    expect(strict.relaxationHints.every(({ resultCount }) => resultCount > 0)).toBe(true);

    const multiSelect = await executeSessionSearch(db, sessionId, 'full_silhouette',
      { formats: ['paper_envelope', 'pdf_a4_letter'], skills: ['confident_beginner', 'intermediate'] });
    expect(multiSelect.results.map(({ patternId }) => patternId)).toContain(flagshipId);
  });

  it('rejects non-garment and unsupported lower-only extraction before embedding or session writes', async () => {
    const before = await db.query('SELECT count(*) FROM query_sessions');
    for (const [status, code] of [
      ['no_garment_detected', 'NO_GARMENT_DETECTED'],
      ['unsupported_category_v1', 'UNSUPPORTED_CATEGORY_V1'],
    ] as const) {
      const deps = fixtures(status, null);
      await expect(analyzeAndSearch(deps, { ...upload(), cropBox: { x: 0, y: 0, width: 0.5, height: 1 } }))
        .rejects.toMatchObject({ code, statusCode: 422 });
      expect(deps.textEmbedder.embedRegions).not.toHaveBeenCalled();
    }
    expect(await db.query('SELECT count(*) FROM query_sessions')).toEqual(before);
  });

  it('searches both categories for partial upper-body input and offers usable alternatives to skirt focus', async () => {
    const deps = fixtures('low_visibility_partial', top);
    const partial = await analyzeAndSearch(deps, { ...upload(), cropBox: { x: 0, y: 0, width: 1, height: 0.5 } });
    expect(partial.queryStatus).toBe('low_visibility_partial');
    expect(new Set(partial.results.map(({ garmentCategory }) => garmentCategory))).toEqual(new Set(['dress', 'top']));
    await expect(executeSessionSearch(db, partial.querySessionId, 'sleeves_armscye', {})).resolves.toMatchObject({
      results: expect.arrayContaining([expect.objectContaining({ garmentCategory: 'top' })]),
    });
    await expect(executeSessionSearch(db, partial.querySessionId, 'skirt_hemline', {})).rejects.toMatchObject({
      code: 'REGION_UNAVAILABLE', statusCode: 422, availableFocusRegions: expect.arrayContaining(['bodice_neckline']),
    });
  });
  it('keeps a usable out-of-scope session for bodice and sleeve refinements', async () => {
    const deps = fixtures('unsupported_category_v1', top);
    const bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#abc' } }).png().toBuffer();
    const result = await analyzeAndSearch(deps, { ...upload(), bytes });
    expect(result).toMatchObject({ queryStatus: 'unsupported_category_v1', extractedProfile: top, results: [] });
    const refined = await executeSessionSearch(db, result.querySessionId, 'bodice_neckline', {});
    expect(refined.results.length).toBeGreaterThan(0);
    expect(deps.visionExtractor.extract).toHaveBeenCalledTimes(1);
    expect(deps.textEmbedder.embedRegions).toHaveBeenCalledTimes(1);
  });

  it('uses a stable view ID to break exact ties and prefers the default band without measurements', async () => {
    const views = await db.query<{ id: string; profile: ConstructionProfileV1; vector: string }>(
      `SELECT id, construction_profile AS profile, vec_full::text AS vector
       FROM pattern_views WHERE pattern_id = $1 ORDER BY id`,
      [flagshipId],
    );
    const [first, second] = views.rows;
    const defaultBand = await db.query<{ id: string }>(
      'SELECT id FROM pattern_size_bands WHERE pattern_id = $1 AND is_default', [flagshipId],
    );
    const tie = await db.query<{ id: string; profile: ConstructionProfileV1; vector: string }>(
      `SELECT id, extracted_profile AS profile, vec_full::text AS vector FROM query_sessions WHERE id = $1`,
      [sessionId],
    );
    try {
      await db.query(
        `UPDATE pattern_views SET construction_profile = $1::jsonb, vec_full = $2::vector
         WHERE id = ANY($3::uuid[])`,
        [JSON.stringify(tie.rows[0].profile), tie.rows[0].vector, [first.id, second.id]],
      );
      const ranked = await executeSessionSearch(db, sessionId, 'full_silhouette', {});
      expect(ranked.results[0]).toMatchObject({
        patternId: flagshipId,
        viewId: first.id,
        matchedSizeBandId: defaultBand.rows[0].id,
      });
      expect(await executeSessionSearch(db, sessionId, 'full_silhouette', {})).toEqual(ranked);
    } finally {
      for (const view of [first, second]) {
        await db.query(
          'UPDATE pattern_views SET construction_profile = $1::jsonb, vec_full = $2::vector WHERE id = $3',
          [JSON.stringify(view.profile), view.vector, view.id],
        );
      }
    }
  });

  it('returns a typed expiration response for an expired session', async () => {
    const { rows: [expired] } = await db.query<{ id: string }>(
      `INSERT INTO query_sessions (image_sha256, query_status, extracted_profile, canonical_texts,
                                   vec_full, vec_bodice, vec_sleeves, vec_skirt, expires_at)
       SELECT 'expired-test', query_status, extracted_profile, canonical_texts,
              vec_full, vec_bodice, vec_sleeves, vec_skirt, now() - interval '1 second'
       FROM query_sessions WHERE id = $1 RETURNING id`,
      [sessionId],
    );
    await expect(executeSessionSearch(db, expired.id, 'full_silhouette', {})).rejects.toMatchObject({
      code: 'SESSION_EXPIRED', statusCode: 404,
    });
  });

});
