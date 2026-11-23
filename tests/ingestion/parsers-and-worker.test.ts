import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import * as supabase from '@/lib/supabase/server';
import { createIngestionWorkerDeps, fetchApprovedShopifyDrafts } from '@/modules/ingestion/production';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';
import { parseSeamLensCsv, type NormalizedImportDraft } from '@/modules/ingestion/parsers';
import { createGalleryPreparer } from '@/modules/ingestion/media-pipeline';
import { executeSessionSearch } from '@/modules/search/hybrid-ranker';
import { enqueueIngestionBatch, processNextIngestionChunk, retryIngestionItem, type IngestionWorkerDeps } from '@/modules/ingestion/chunk-worker';

const db = new PGlite({ extensions: { vector } });
let makerId: string;
let deps: IngestionWorkerDeps;
const band = { externalProductId: null, bandLabel: 'Standard', isDefault: true, productUrl: 'https://example.org/item', priceCents: null, currency: 'USD', designerSizeLabel: null, bustMinIn: 33, bustMaxIn: 55, hipMinIn: 34, hipMaxIn: 58 };
const draft: NormalizedImportDraft = { title: 'Test dress', groupKey: 'test-dress', formatsHint: [], descriptionHtml: '', imageUrls: [], sizeBands: [band] };
const enqueue = (item = draft) => enqueueIngestionBatch(db, { makerId, sourceType: 'csv_upload', sourceDescriptor: 'test.csv', drafts: [item], createdBy: randomUUID() });
const status = (value: string) => db.query('update makers set vetted_status=$1 where id=$2', [value, makerId]);

beforeAll(async () => {
  for (const file of (await readdir('supabase/migrations')).sort()) await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
  await seedSyntheticCatalog(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  const slug = randomUUID();
  makerId = (await db.query<{id:string}>("insert into makers(slug,name,storefront_url,platform_type,vetted_status) values($1,'Test','https://example.org','custom','approved') returning id", [slug])).rows[0].id;
  const profile = (await db.query<{construction_profile:ConstructionProfileV1}>("select construction_profile from pattern_views where garment_category='dress' limit 1")).rows[0].construction_profile;
  const bytes = await readFile('public/catalog-media/archetypes/square-neck-puff-midi.webp');
  const v = Array(768).fill(0.1);
  deps = { db, prepareGallery: vi.fn(async () => ['A','B'].map(viewCode => ({viewCode, viewLabel:viewCode, images: (['cover','flat_front'] as const).map(role => ({role, mimeType:'image/webp', bytes, fullPath:role+'-full.webp', cardPath:role+'-card.webp'}))}))),
    vision: { extract: vi.fn(async () => ({profile, status:'ok' as const, aiConfidence:.75, warnings:[], inputTokens:1,outputTokens:1})) },
    embedder: { embedRegions: vi.fn(async () => ({modelId:'test-ingest',vectors:{full:v,bodice:v,sleeves:v,skirt:v},inputTokens:1})) } };
});
it('checks maker permission on enqueue, claim and before final writes', async () => {
  await status('pending');
  await expect(enqueue()).rejects.toThrow(/approved/i);
  await status('approved');
  const {batchId} = await enqueue();
  await status('suspended');
  await expect(processNextIngestionChunk(deps,batchId)).rejects.toThrow(/approved/i);
  expect(deps.prepareGallery).not.toHaveBeenCalled();
  await status('approved');
  const embed = deps.embedder.embedRegions;
  let embeddings = 0;
  deps.embedder.embedRegions = async (...args) => {
    const result = await embed(...args);
    if (++embeddings === 2) await status('suspended');
    return result;
  };
  expect((await processNextIngestionChunk(deps,batchId)).failed).toBe(1);
  expect((await db.query('select id from patterns where maker_id=$1',[makerId])).rows).toHaveLength(0);
});
it('keeps stable IDs, preserves curated views and records incomplete bands for review', async () => {
  const incomplete = {...band,bandLabel:'Curve',bustMinIn:null};
  const run = async (item: NormalizedImportDraft) => {
    const {batchId} = await enqueue(item);
    expect(await processNextIngestionChunk(deps,batchId)).toMatchObject({completed:1,failed:0,status:'completed'});
    return (await db.query<{pattern_id:string;review_flags:string[];raw_payload:NormalizedImportDraft}>('select * from ingestion_items where batch_id=$1',[batchId])).rows[0];
  };
  const first = await run({...draft,sizeBands:[band,incomplete]});
  expect(first.review_flags).toEqual(expect.arrayContaining(['missing_measurements','low_confidence']));
  expect(first.raw_payload.sizeBands[1]).toEqual(incomplete);
  expect(vi.mocked(deps.vision.extract).mock.calls[0][0].images[0].role).toBe('flat_front');
  const ids = async () => (await db.query('select b.id as band,v.id as view from pattern_size_bands b join pattern_views v using(pattern_id) where b.pattern_id=$1 order by v.view_code',[first.pattern_id])).rows;
  const original = await ids();
  expect(original).toHaveLength(2);
  expect((await db.query('select distinct embedding_model from pattern_views where pattern_id=$1',
    [first.pattern_id])).rows).toEqual([{embedding_model:'test-ingest'}]);
  await run(draft);
  expect(await ids()).toEqual(original);
  await db.query('update pattern_views set human_verified=true where pattern_id=$1',[first.pattern_id]);
  expect((await run({...draft,title:'Changed'})).review_flags).toContain('curated_reimport');
  expect((await db.query<{title:string}>('select title from patterns where id=$1',[first.pattern_id])).rows[0].title).toBe(draft.title);
});
it('reclaims expired work, rejects a stale completion and retries the same failed row', async () => {
  const {batchId} = await enqueue();
  const prepare = deps.prepareGallery;
  let resume!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>(r => {started=r;});
  const pause = new Promise<void>(r => {resume=r;});
  deps.prepareGallery = async input => { const result = await prepare(input); started(); await pause; return result; };
  const stale = processNextIngestionChunk(deps,batchId);
  await startedPromise;
  expect((await processNextIngestionChunk(deps,batchId)).processed).toBe(0);
  await db.query("update ingestion_items set claim_expires_at=now()-interval '1 second' where batch_id=$1",[batchId]);
  deps.prepareGallery = async () => { throw Error('temporary'); };
  expect((await processNextIngestionChunk(deps,batchId)).failed).toBe(1);
  const {id} = (await db.query<{id:string}>('select id from ingestion_items where batch_id=$1',[batchId])).rows[0];
  await retryIngestionItem(db,id);
  deps.prepareGallery=prepare;
  expect((await processNextIngestionChunk(deps,batchId)).completed).toBe(1);
  resume();
  expect((await stale).completed).toBe(0);
  expect((await db.query('select completed_items,failed_items,total_items from ingestion_batches where id=$1',[batchId])).rows).toEqual([{completed_items:1,failed_items:0,total_items:1}]);
});

it('preserves sibling band identities across a renamed design and protects a published import', async () => {
  const sizeBands = [
    { ...band, externalProductId: 'shop-1', bandLabel: 'Straight' },
    { ...band, externalProductId: 'shop-2', bandLabel: 'Curve', isDefault: false },
  ];
  const importDesign = async (item: NormalizedImportDraft) => {
    const { batchId } = await enqueue(item);
    expect(await processNextIngestionChunk(deps, batchId)).toMatchObject({ completed: 1, failed: 0 });
    const { rows: [queueItem] } = await db.query<{ pattern_id: string; review_flags: string[] }>(
      'select pattern_id,review_flags from ingestion_items where batch_id=$1', [batchId]
    );
    return queueItem;
  };
  const original = await importDesign({ ...draft, sizeBands });
  const readBands = async () => (await db.query<{ id: string; band_label: string }>(
    'select id,band_label from pattern_size_bands where pattern_id=$1 order by external_product_id', [original.pattern_id]
  )).rows;
  const originalBands = await readBands();
  expect(originalBands.map(b => b.band_label)).toEqual(['Straight','Curve']);
  const renamed = await importDesign({
    ...draft, groupKey: 'new-name', sizeBands: [sizeBands[0], { ...sizeBands[1], bandLabel: 'Extended' }]
  });
  expect(renamed.pattern_id).toBe(original.pattern_id);
  expect((await readBands()).map(b => b.id)).toEqual(originalBands.map(b => b.id));
  await db.query("update patterns set status='published' where id=$1", [original.pattern_id]);
  const published = await importDesign({ ...draft, sizeBands });
  expect(published.review_flags).toContain('curated_reimport');
  expect((await readBands())[1].band_label).toBe('Extended');
  expect((await db.query<{status:string}>('select status from patterns where id=$1', [original.pattern_id])).rows[0].status).toBe('published');
});

it('renews a live lease between expensive stages without reviving expired ownership', async () => {
  const { batchId } = await enqueue();
  const prepare = deps.prepareGallery;
  deps.prepareGallery = async (input) => {
    await db.query("update ingestion_items set claim_expires_at = now()+interval '12 seconds' where batch_id=$1",[batchId]);
    await input.assertActive();
    const { rows: [lease] } = await db.query<{ renewed: boolean }>(
      "select claim_expires_at > now()+interval '30 seconds' as renewed from ingestion_items where batch_id=$1", [batchId]
    );
    if (!lease.renewed) throw Error('Lease was not renewed');
    return prepare(input);
  };
  expect(await processNextIngestionChunk(deps, batchId)).toMatchObject({ completed: 1, failed: 0 });
});

it('leaves both designs intact when an external ID is moved across designs', async () => {
  const run = async (item: NormalizedImportDraft) => {
    const { batchId } = await enqueue(item);
    return processNextIngestionChunk(deps, batchId);
  };
  const first = { ...draft, sizeBands: [{ ...band, externalProductId: 'first' }] };
  const second = { ...draft, groupKey: 'second', sizeBands: [{ ...band, externalProductId: 'second' }] };
  expect((await run(first)).completed).toBe(1);
  expect((await run(second)).completed).toBe(1);
  const read = () => db.query(
    'select id, pattern_id, external_product_id from pattern_size_bands where maker_id=$1 order by id', [makerId]
  );
  const original = (await read()).rows;
  expect((await run({ ...second, sizeBands: first.sizeBands })).failed).toBe(1);
  expect((await read()).rows).toEqual(original);
});

it('stores bust-only top bands, flags partial hips, and bounds multibyte extraction context', async () => {
  const sizeBands = [
    { ...band, hipMinIn: null, hipMaxIn: null },
    { ...band, bandLabel: 'Curve', hipMaxIn: null },
  ];
  const { batchId } = await enqueue({
    ...draft, garmentCategoryHint: 'top', sizeBands, descriptionHtml: '<p>' + '縫🪡'.repeat(6000) + '</p>'
  });
  expect((await processNextIngestionChunk(deps, batchId)).completed).toBe(1);
  const context = vi.mocked(deps.vision.extract).mock.calls[0][0].contextText!;
  expect(Buffer.byteLength(context)).toBeLessThanOrEqual(16 * 1024);
  expect(context).not.toContain('\uFFFD');
  const { rows: [item] } = await db.query<{ pattern_id: string; review_flags: string[] }>(
    'select pattern_id,review_flags from ingestion_items where batch_id=$1', [batchId]
  );
  expect(item.review_flags).toContain('missing_measurements');
  expect((await db.query(
    'select band_label,hip_min_in,hip_max_in from pattern_size_bands where pattern_id=$1', [item.pattern_id]
  )).rows).toEqual([{ band_label: 'Standard', hip_min_in: null, hip_max_in: null }]);
});

it('makes interrupted legacy items claimable while preserving duplicated source references', async () => {
  const legacy = new PGlite({ extensions: { vector } });
  try {
    const files = (await readdir('supabase/migrations')).sort();
    const migration = files.indexOf('202611220004_ingestion_claims.sql');
    for (const file of files.slice(0, migration)) await legacy.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    const batchId = randomUUID();
    const maker = randomUUID();
    await legacy.query(`insert into makers(id,slug,name,storefront_url,platform_type,vetted_status)
      values($1,'maker','Maker','https://example.org','custom','approved')`, [maker]);
    await legacy.query(`insert into ingestion_batches(id,maker_id,source_type,source_descriptor,created_by,total_items,status)
      values($1,$2,'csv_upload','source.csv',$3,2,'processing')`, [batchId,maker,randomUUID()]);
    for (const stage of ['vision_extracted','media_synced']) {
      await legacy.query(`insert into ingestion_items(batch_id,external_ref,raw_payload,stage) values($1,'repeat',$2,$3)`,
        [batchId,JSON.stringify(draft),stage]);
    }
    await legacy.exec(await readFile('supabase/migrations/' + files[migration], 'utf8'));
    const { rows } = await legacy.query<{ stage: string; item_key: string }>('select stage,item_key from ingestion_items');
    expect(rows.map(item => item.stage)).toEqual(['queued','queued']);
    expect(new Set(rows.map(item => item.item_key)).size).toBe(2);
  } finally {
    await legacy.close();
  }
});

it('recovers a design from an earlier incomplete external band after a title change', async () => {
  const incomplete = { ...band, externalProductId: 'missing-bust', bustMinIn: null };
  const run = async (item: NormalizedImportDraft) => {
    const { batchId } = await enqueue(item);
    expect((await processNextIngestionChunk(deps,batchId)).completed).toBe(1);
    return (await db.query<{pattern_id:string}>('select pattern_id from ingestion_items where batch_id=$1',[batchId])).rows[0].pattern_id;
  };
  const original = await run({ ...draft, sizeBands: [incomplete] });
  const renamed = { ...draft, groupKey: 'renamed-dress', title: 'Renamed dress', sizeBands: [incomplete] };
  expect(await run(renamed)).toBe(original);
  expect(await run({ ...renamed, sizeBands: [{ ...band, externalProductId: null }] })).toBe(original);
});

it('flags partial extractions and rejects unsupported classifications with a supplied profile', async () => {
  const extract = deps.vision.extract;
  deps.vision.extract = async input => ({ ...await extract(input), status:'low_visibility_partial', aiConfidence:.92 });
  const { batchId } = await enqueue();
  expect((await processNextIngestionChunk(deps, batchId)).completed).toBe(1);
  const { rows: [item] } = await db.query<{ review_flags:string[] }>('select review_flags from ingestion_items where batch_id=$1',[batchId]);
  expect(item.review_flags).toContain('partial_visibility');
  deps.vision.extract = async input => ({ ...await extract(input), status:'unsupported_category_v1' });
  const next = await enqueue();
  expect((await processNextIngestionChunk(deps,next.batchId)).failed).toBe(1);
});

it('keeps a parsed import out of public search until curated, then returns its saved band and cover', async () => {
  const [design] = parseSeamLensCsv([
    'title,product_url,band_label,bust_min_in,bust_max_in,hip_min_in,hip_max_in,cover_image_url,flat_front_image_url,formats,skill_level',
    'Elm,https://maker.example/elm,Curve,60,72,62,80,https://maker.example/cover,https://maker.example/front,projector,advanced_couture',
  ].join('\n'));
  const sourceImage = await readFile('public/catalog-media/archetypes/square-neck-puff-midi.webp');
  const stored = new Set<string>();
  deps.prepareGallery = createGalleryPreparer({
    fetchImage: async () => sourceImage,
    classify: async () => { throw new Error('Explicit views do not require classification'); },
    write: async key => { stored.add(key); return 'catalog-media/' + key; },
  });
  const { batchId } = await enqueue(design);
  expect(await processNextIngestionChunk(deps, batchId)).toMatchObject({ completed: 1 });
  const { rows: [item] } = await db.query<{pattern_id:string}>('SELECT pattern_id FROM ingestion_items WHERE batch_id=$1', [batchId]);
  const { rows: [session] } = await db.query<{id:string}>(`
    INSERT INTO query_sessions (image_sha256, query_status, extracted_profile, canonical_texts, vec_full, vec_bodice, vec_sleeves, vec_skirt)
    SELECT 'integrated-import', 'ok', construction_profile, canonical_texts, vec_full, vec_bodice, vec_sleeves, vec_skirt
    FROM pattern_views WHERE pattern_id=$1 RETURNING id`, [item.pattern_id]);
  const search = () => executeSessionSearch(db, session.id, 'full_silhouette', {
    userBustIn: 69, userHipIn: 74, formats: ['projector'], skills: ['advanced_couture'],
  });
  expect((await search()).results).toHaveLength(0);
  await db.query('UPDATE pattern_views SET human_verified=true WHERE pattern_id=$1', [item.pattern_id]);
  await db.query("UPDATE patterns SET status='published' WHERE id=$1", [item.pattern_id]);
  const [card] = (await search()).results;
  const { rows: [band] } = await db.query<{id:string}>('SELECT id FROM pattern_size_bands WHERE pattern_id=$1', [item.pattern_id]);
  expect(card).toMatchObject({ patternId: item.pattern_id, matchedSizeBandId: band.id, title: 'Elm' });
  const coverKey = card.coverImageUrl.split('/catalog-media/').pop()!;
  expect(stored.has(coverKey)).toBe(true);
  expect(stored.has(coverKey.replace('-card.webp','-full.webp'))).toBe(true);
});

it('processes the demo Shopify feed into a review draft through real media preparation', async () => {
  vi.stubEnv('SEAMLENS_LOCAL_DEMO', '1');
  vi.stubEnv('DATABASE_URL', 'postgres://demo:fixture@127.0.0.1:5432/seamlens_demo');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3101');
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('GEMINI_API_KEY', '');
  const files = new Map<string, Buffer>();
  const client = createClient('http://127.0.0.1:3101', 'demo', {
    global: { fetch: async (input, options) => {
      const request = new Request(input, options);
      const url = new URL(request.url);
      expect(url.origin).toBe('http://127.0.0.1:3101');
      expect(request.method).toBe('POST');
      expect(request.headers.get('content-type')).toBe('image/webp');
      files.set(url.pathname, Buffer.from(await request.arrayBuffer()));
      return Response.json({ Key: url.pathname });
    } },
  });
  const serviceClient = vi.spyOn(supabase, 'createSupabaseServiceClient').mockReturnValue(client);
  try {
    const { rows: [maker] } = await db.query<{ id: string }>("SELECT id FROM makers WHERE slug='maison-verveine'");
    const drafts = await fetchApprovedShopifyDrafts(db, maker.id);
    const { batchId } = await enqueueIngestionBatch(db, {
      makerId: maker.id, sourceType: 'shopify_json', sourceDescriptor: 'Bundled Shopify feed', drafts, createdBy: randomUUID(),
    });
    const production = createIngestionWorkerDeps(db);
    expect(await processNextIngestionChunk(production, batchId)).toMatchObject({ completed: 1, failed: 0, status: 'completed' });
    const { rows } = await db.query(
      "SELECT i.stage, v.embedding_model, v.construction_profile->'sleeves_and_armscye'->>'armscye_construction' AS armhole FROM ingestion_items i JOIN pattern_views v ON v.pattern_id=i.pattern_id WHERE i.batch_id=$1",
      [batchId],
    );
    expect(rows).toEqual([{ stage: 'ready_for_review', embedding_model: 'deterministicTextToVector768', armhole: 'raglan' }]);
    expect([...files.keys()].sort()).toEqual([
      expect.stringMatching(/^\/storage\/v1\/object\/catalog-media\/maison-verveine\/.*\/default\/cover-.*-card\.webp$/),
      expect.stringMatching(/^\/storage\/v1\/object\/catalog-media\/maison-verveine\/.*\/default\/cover-.*-full\.webp$/),
    ]);
    expect([...files.values()].every(bytes => bytes.toString('ascii', 8, 12) === 'WEBP')).toBe(true);
  } finally {
    serviceClient.mockRestore();
    vi.unstubAllEnvs();
  }
});
