import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { getTelemetrySummary } from '@/modules/admin/telemetry-repo';
import {
  mergeSizeBandIntoPattern, savePatternViewCuration, setPatternPublishStatus, type SizeBandInput,
} from '@/modules/admin/curation-actions';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';
import { withTransaction } from '@/lib/db';
import { executeSessionSearch } from '@/modules/search/hybrid-ranker';
import { persistDraft } from '@/modules/ingestion/draft-persistence';
import { parseSeamLensCsv } from '@/modules/ingestion/parsers';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import type { TextEmbedder } from '@/modules/vision/types';

const user = { id: randomUUID(), email: 'curator@example.org' };
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabase/server')>(),
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));

const db = new PGlite({ extensions: { vector } });
const slug = 'solene-square-puff-midi-dress';

async function editForm(patternSlug = slug) {
  const { rows } = await db.query<{
    viewId: string; expectedUpdatedAt: string; constructionProfile: ConstructionProfileV1;
    patternId: string; makerId: string;
  }>(`SELECT v.id AS "viewId", v.updated_at::text AS "expectedUpdatedAt",
       v.construction_profile AS "constructionProfile", p.id AS "patternId", p.maker_id AS "makerId"
       FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id
      WHERE p.slug=$1 ORDER BY v.view_code`, [patternSlug]);
  const { rows: sizeBands } = await db.query<SizeBandInput>(`SELECT id, band_label AS "bandLabel",
      is_default AS "isDefault", product_url AS "productUrl", price_cents AS "priceCents", currency,
      designer_size_label AS "designerSizeLabel", bust_min_in::float8 AS "bustMinIn",
      bust_max_in::float8 AS "bustMaxIn", hip_min_in::float8 AS "hipMinIn", hip_max_in::float8 AS "hipMaxIn"
      FROM pattern_size_bands WHERE pattern_id=$1 ORDER BY is_default DESC`, [rows[0].patternId]);
  return rows.map(view => ({
    ...view, sizeBands, substrateType: 'woven' as const, formats: ['projector' as const],
    skillLevel: 'advanced_couture' as const,
  }));
}

const unit = Array<number>(768).fill(0);
unit[0] = 1;
const fixedEmbedder: TextEmbedder = {
  embedRegions: async texts => ({
    vectors: { full: unit, bodice: unit, sleeves: unit, skirt: texts.skirt_hemline ? unit : null }, inputTokens: 10,
  }),
};

async function importHistory(patternId: string, makerId: string, bands: object[]) {
  const batch = await db.query<{id:string}>(`INSERT INTO ingestion_batches
    (maker_id,source_type,source_descriptor,created_by) VALUES ($1,'csv_upload','raw.csv',$2) RETURNING id`,
    [makerId, user.id]);
  const { rows: [item] } = await db.query<{id:string}>(`INSERT INTO ingestion_items
    (batch_id,item_key,external_ref,stage,pattern_id,raw_payload,review_flags)
    VALUES ($1,'ref:duplicate','duplicate','ready_for_review',$2,$3,'{missing_measurements}')
    RETURNING id`, [batch.rows[0].id, patternId, JSON.stringify({ sizeBands: bands })]);
  return item.id;
}

beforeAll(async () => {
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  }
  await db.query("INSERT INTO admin_users (user_id,email,role) VALUES ($1,$2,'curator')", [user.id, user.email]);
}, 30000);
beforeEach(async () => {
  await db.exec('TRUNCATE makers, api_usage_ledger, api_usage_reservations, search_events CASCADE');
  await seedSyntheticCatalog(db);
  getUser.mockResolvedValue({ data: { user }, error: null });
});
afterAll(() => db.close());

describe('verified curation', () => {
  it('fills a missing imported band and atomically saves the edited neckline, normalized document vectors and reviewer', async () => {
    const [form] = await editForm();
    const band = { ...form.sizeBands[1], id: undefined, externalProductId: 'missing' };
    await db.query('DELETE FROM pattern_size_bands WHERE id=$1', [form.sizeBands[1].id]);
    const itemId = await importHistory(form.patternId, form.makerId, [{ ...band, bustMinIn: null }]);
    form.sizeBands[1] = band;
    form.constructionProfile.bodice_and_neckline.neckline_type = 'sweetheart';
    const embedContent = vi.fn(async () => ({
      embeddings: Array.from({ length: 4 }, () => ({
        values: unit.map(x => x*4), statistics: { tokenCount: 12 },
      })),
    }));
    const embedder = createGeminiTextEmbedder(db, { models: { embedContent } });
    await savePatternViewCuration({ db, embedder }, form);
    const { rows: [view] } = await db.query<{canonical:string;full:string}>(`SELECT embedding_model, human_verified, verified_by, verified_at IS NOT NULL AS reviewed,
       construction_profile #>> '{bodice_and_neckline,neckline_type}' AS neckline,
       canonical_texts->>'full_silhouette' AS canonical, vector_norm(vec_full) AS norm,
       vec_full::text AS full FROM pattern_views WHERE id=$1`, [form.viewId]);
    expect(view).toMatchObject({ embedding_model: 'gemini-embedding-001', human_verified: true, reviewed: true, verified_by: user.id, neckline: 'sweetheart', norm: 1 });
    expect(view.canonical).toContain('neckline: sweetheart');
    expect(JSON.parse(String(view.full))).toEqual(unit);
    expect(await db.query("SELECT skill_level,formats FROM patterns WHERE id=$1", [form.patternId]))
      .toMatchObject({ rows: [{ skill_level:'advanced_couture', formats:['projector'] }] });
    expect(await db.query("SELECT bust_min_in::int AS bust FROM pattern_size_bands WHERE external_product_id='missing'"))
      .toMatchObject({ rows: [{ bust:44 }] });
    expect(await db.query('SELECT review_flags FROM ingestion_items WHERE id=$1', [itemId]))
      .toMatchObject({ rows:[{ review_flags:[] }] });
    expect(await db.query('SELECT operation,request_count FROM api_usage_ledger'))
      .toMatchObject({ rows:[{ operation:'ingest_embed', request_count:1 }] });
  });

  it('rejects an edit from a different view after their shared bands change during embedding', async () => {
    const [first, second] = await editForm();
    const interruptingEmbedder: TextEmbedder = {
      async embedRegions(texts, task) {
        const winner = { ...first, sizeBands: first.sizeBands.map(band => ({ ...band, priceCents: 1234 })) };
        await savePatternViewCuration({ db, embedder: fixedEmbedder }, winner);
        return fixedEmbedder.embedRegions(texts, task);
      },
    };
    await expect(savePatternViewCuration({ db, embedder: interruptingEmbedder }, second)).rejects.toThrow(/stale|changed|reload/i);
    expect(await db.query('SELECT DISTINCT price_cents FROM pattern_size_bands WHERE pattern_id=$1', [first.patternId]))
      .toMatchObject({ rows:[{ price_cents:1234 }] });
  });

  it('distinguishes two database revisions within the same JavaScript millisecond', async () => {
    const [first] = await editForm();
    const { rows: [extra] } = await db.query<{id:string; revision:string}>(`INSERT INTO pattern_views (
        pattern_id,view_code,view_label,garment_category,cover_image_path,construction_profile,canonical_texts,
        vec_full,vec_bodice,vec_sleeves,vec_skirt,updated_at)
      SELECT pattern_id,'precision','Precision',garment_category,cover_image_path,construction_profile,canonical_texts,
        vec_full,vec_bodice,vec_sleeves,vec_skirt,'2099-01-01 00:00:00.123456+00' FROM pattern_views WHERE id=$1
      RETURNING id,updated_at::text AS revision`, [first.viewId]);
    const input = { ...first, viewId: extra.id, expectedUpdatedAt: extra.revision };
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, input);
    const { rows: [latest] } = await db.query<{revision:string}>(
      'SELECT updated_at::text AS revision FROM pattern_views WHERE id=$1', [extra.id]);
    expect(new Date(latest.revision).getTime()).toBe(new Date(extra.revision).getTime());
    expect(latest.revision).not.toBe(extra.revision);
    await expect(savePatternViewCuration({ db, embedder: fixedEmbedder }, input)).rejects.toThrow(/reload/i);
  });

  it('preserves the complete version on model failure, invalid measurements and foreign band IDs', async () => {
    const [form] = await editForm();
    const snapshot = async () => (await db.query(`SELECT to_jsonb(v) AS view, to_jsonb(p) AS parent,
       (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM pattern_size_bands b WHERE b.pattern_id=p.id) AS bands
       FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id WHERE v.id=$1`, [form.viewId])).rows;
    const before = await snapshot();
    await expect(savePatternViewCuration({ db, embedder: { embedRegions: async () => { throw Error('model unavailable'); } } }, form))
      .rejects.toThrow(/model unavailable/);
    form.sizeBands[1].hipMaxIn = 21;
    await expect(savePatternViewCuration({ db, embedder: fixedEmbedder }, form)).rejects.toThrow();
    form.sizeBands[1].hipMaxIn = 55;
    form.sizeBands[1].id = (await editForm('linden-cropped-square-blouse'))[0].sizeBands[0].id;
    await expect(savePatternViewCuration({ db, embedder: fixedEmbedder }, form)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it('enforces verified allowlist access even when mutations are called directly', async () => {
    const [form] = await editForm();
    getUser.mockResolvedValue({ data: { user: { id:randomUUID(), email:'outsider@example.org' } }, error:null });
    for (const action of [
      () => savePatternViewCuration({ db, embedder: fixedEmbedder }, form),
      () => setPatternPublishStatus(db, form.patternId, 'takedown'),
      () => mergeSizeBandIntoPattern(db, form.patternId, randomUUID(), 'Curve'),
      () => getTelemetrySummary(db, 7),
    ]) await expect(action()).rejects.toMatchObject({ status:403 });
  });

  it('keeps a distinct imported product with a reused band label pending until its own measurements are saved', async () => {
    const [first] = await editForm();
    const original = first.sizeBands[0];
    const incoming = { ...original, id: undefined, isDefault: false, externalProductId: 'new-edition' };
    const item = await importHistory(first.patternId, first.makerId, [incoming]);
    const flags = async () => (await db.query<{review_flags: string[]}>(
      'SELECT review_flags FROM ingestion_items WHERE id=$1', [item])).rows[0].review_flags;
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, first);
    expect(await flags()).toContain('missing_measurements');
    await expect(setPatternPublishStatus(db, first.patternId, 'published')).rejects.toThrow(/measurements/);
    const [next] = await editForm();
    next.sizeBands.push({ ...incoming, bandLabel: 'New edition', bustMaxIn: 62 });
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, next);
    expect(await flags()).toEqual([]);
  });

  it('aborts the save when membership is revoked during the external embedding request', async () => {
    const [form] = await editForm();
    const revokingEmbedder: TextEmbedder = {
      async embedRegions(texts, task) {
        await db.query('DELETE FROM admin_users WHERE user_id=$1', [user.id]);
        return fixedEmbedder.embedRegions(texts, task);
      },
    };
    try {
      await expect(savePatternViewCuration({ db, embedder: revokingEmbedder }, form)).rejects.toMatchObject({ status:403 });
      expect((await editForm())[0].expectedUpdatedAt).toBe(form.expectedUpdatedAt);
    } finally {
      await db.query("INSERT INTO admin_users (user_id,email,role) VALUES ($1,$2,'curator')", [user.id,user.email]);
    }
  });

  it('resolves each reimport after every affected view is reviewed against that source', async () => {
    const [first] = await editForm();
    const extraBand = { ...first.sizeBands[0], id: undefined, bandLabel:'Edition II', isDefault: false, externalProductId:'edition-ii' };
    const incoming = await importHistory(first.patternId, first.makerId, [extraBand]);
    const viewsOnly = await importHistory(first.patternId, first.makerId, []);
    const historical = await importHistory(first.patternId, first.makerId, []);
    await db.query(`UPDATE pattern_views SET human_verified=true, verified_at=now()-interval '1 day'
      WHERE pattern_id=$1`, [first.patternId]);
    await db.query(`UPDATE ingestion_items SET review_flags=ARRAY['curated_reimport'],
      updated_at=CASE WHEN id=$1 THEN now()-interval '2 days' ELSE clock_timestamp() END WHERE id=ANY($2::uuid[])`,
      [historical, [historical, incoming, viewsOnly]]);
    const remaining = async (id: string) => (await db.query<{review_flags:string[]}>(
      'SELECT review_flags FROM ingestion_items WHERE id=$1', [id])).rows[0].review_flags;
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, (await editForm())[0]);
    expect(await remaining(historical)).toEqual([]);
    expect(await remaining(viewsOnly)).toEqual(['curated_reimport']);
    expect(await remaining(incoming)).toEqual(['curated_reimport']);
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, (await editForm())[1]);
    expect(await remaining(viewsOnly)).toEqual([]);
    expect(await remaining(incoming)).toEqual(['curated_reimport']);
    const [reconciled] = await editForm();
    reconciled.sizeBands.push(extraBand);
    await savePatternViewCuration({ db, embedder: fixedEmbedder }, reconciled);
    expect(await remaining(incoming)).toEqual([]);
  });

  it('moves a single draft offering within one maker while retaining historical references', async () => {
    const [target] = await editForm('brier-plaid-camp-shirt');
    const { rows: [source] } = await db.query<{id:string}>(`INSERT INTO patterns
       (maker_id,slug,title,garment_category,substrate_type,formats,skill_level)
       SELECT maker_id,'duplicate','Duplicate',garment_category,substrate_type,formats,skill_level FROM patterns
        WHERE id=$1 RETURNING id`, [target.patternId]);
    const { rows: [band] } = await db.query<{id:string}>(`INSERT INTO pattern_size_bands
       (pattern_id,maker_id,band_label,product_url,bust_min_in,bust_max_in)
       VALUES ($1,$2,'Standard','https://maker.example/curve',44,64) RETURNING id`, [source.id,target.makerId]);
    const item = await importHistory(source.id, target.makerId, []);
    await db.query(`INSERT INTO outbound_clicks (pattern_id,size_band_id,maker_id,destination_url)
      VALUES ($1,$2,$3,'https://maker.example/curve')`, [source.id, band.id, target.makerId]);
    const [other] = await editForm();
    await expect(mergeSizeBandIntoPattern(db, source.id, other.patternId, 'Curve')).rejects.toThrow();
    await mergeSizeBandIntoPattern(db, source.id, target.patternId, 'Curve');
    expect(await db.query('SELECT id,band_label,is_default FROM pattern_size_bands WHERE pattern_id=$1 ORDER BY is_default DESC',[target.patternId]))
      .toMatchObject({ rows:[{ id:target.sizeBands[0].id, is_default:true },{id:band.id,band_label:'Curve',is_default:false}] });
    expect(await db.query('SELECT pattern_id FROM ingestion_items WHERE id=$1',[item]))
      .toMatchObject({ rows:[{pattern_id:source.id}] });
    expect(await db.query('SELECT pattern_id,size_band_id FROM outbound_clicks'))
      .toMatchObject({ rows:[{pattern_id:source.id,size_band_id:band.id}] });
    await expect(setPatternPublishStatus(db, source.id, 'published')).rejects.toThrow();

    // A repeat import with the original slug or raw external reference must resolve
    // to the retained design, even when the source offering has been renamed.
    const [draft] = parseSeamLensCsv('title,product_url\nDuplicate,https://maker.example/curve');
    const profile = target.constructionProfile;
    const texts = serializeCanonicalRegions(profile);
    const { vectors } = await fixedEmbedder.embedRegions(texts, 'RETRIEVAL_DOCUMENT');
    const revisionBeforeImport = (await editForm('brier-plaid-camp-shirt'))[0].expectedUpdatedAt;
    const result = await withTransaction(db, tx => persistDraft(tx, target.makerId, 'duplicate', draft, [{
      profile, texts, vectors, confidence: 0.9, partialVisibility: false,
      view: { viewLabel: 'Reimport', viewCode: 'duplicate', images: [] },
    }]));
    expect(result).toMatchObject({ patternId:target.patternId, flags:expect.arrayContaining(['curated_reimport']) });
    expect((await editForm('brier-plaid-camp-shirt'))[0].expectedUpdatedAt).not.toBe(revisionBeforeImport);
  });

  it('enforces the database publish gate and preserves first publication time across status changes', async () => {
    const [form] = await editForm();
    const original = (await db.query('SELECT published_at::text FROM patterns WHERE id=$1',[form.patternId])).rows;
    const { rows: [session] } = await db.query<{id:string}>(`INSERT INTO query_sessions
      (image_sha256,query_status,extracted_profile,canonical_texts,vec_full,vec_bodice,vec_sleeves,vec_skirt)
      SELECT 'admin-visibility','ok',construction_profile,canonical_texts,vec_full,vec_bodice,vec_sleeves,vec_skirt
        FROM pattern_views WHERE id=$1 RETURNING id`, [form.viewId]);
    const visible = async () => (await executeSessionSearch(db, session.id, 'full_silhouette', {})).results
      .some(card => card.patternId === form.patternId);
    expect(await visible()).toBe(true);
    for (const status of ['unpublished','published','takedown','published'] as const) {
      await setPatternPublishStatus(db, form.patternId, status);
      expect((await db.query('SELECT status FROM patterns WHERE id=$1',[form.patternId])).rows).toEqual([{status}]);
      expect(await visible()).toBe(status === 'published');
    }
    await db.query("UPDATE makers SET vetted_status='suspended' WHERE id=$1",[form.makerId]);
    expect(await visible()).toBe(false);
    await expect(setPatternPublishStatus(db, form.patternId, 'published')).rejects.toThrow();
    expect((await db.query('SELECT published_at::text FROM patterns WHERE id=$1',[form.patternId])).rows).toEqual(original);
  });
});

it('measures successful search events and clicks in separate rolling windows and charges only today’s settled spend', async () => {
  const [form] = await editForm();
  await db.exec(`INSERT INTO search_events (source_type,focus_region,filters_applied,result_count,latency_ms,created_at)
    VALUES ('upload','full_silhouette','{}',0,100,now()),('filter_refinement','full_silhouette','{}',1,200,now()-interval '5 days'),
      ('url','full_silhouette','{}',1,300,now()-interval '15 days'),('upload','full_silhouette','{}',9,900,now()-interval '31 days');
    INSERT INTO api_usage_ledger (usage_date,operation,estimated_cost_usd) VALUES
      ((now() AT TIME ZONE 'UTC')::date,'ingest_embed',0.75),((now() AT TIME ZONE 'UTC')::date - 1,'search_vision',1.50)`);
  await db.query(`INSERT INTO outbound_clicks (pattern_id,maker_id,destination_url,created_at)
    VALUES ($1,$2,'https://maker.example',now()),($1,$2,'https://maker.example',now()-interval '8 days')`,[form.patternId,form.makerId]);
  expect(await getTelemetrySummary(db,7)).toMatchObject({ searches:2, clicks:1, outboundCtr:0.5,
    p50LatencyMs:150,p95LatencyMs:195,dailySpendUsd:0.75,perMakerClicks:[{makerId:form.makerId,clicks:1}] });
  expect(await getTelemetrySummary(db,30)).toMatchObject({ searches:3, clicks:2, outboundCtr:2/3,
    p50LatencyMs:200,p95LatencyMs:290,dailySpendUsd:0.75,perMakerClicks:[{makerId:form.makerId,clicks:2}] });
  await db.exec('TRUNCATE search_events');
  expect(await getTelemetrySummary(db,7)).toMatchObject({ searches:0,clicks:1,outboundCtr:0,p50LatencyMs:null,p95LatencyMs:null });
});
