import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { readdirSync, readFileSync } from 'node:fs';
import { getEditor, listQueue, saveMaker } from '@/modules/admin/cockpit-repo';
import { seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const migration of readdirSync('supabase/migrations').sort()) {
    await db.exec(readFileSync('supabase/migrations/' + migration, 'utf8'));
  }
  await seedSyntheticCatalog(db);
});
afterAll(async () => { await db?.close(); });

it('keeps imported editions with incomplete measurements editable alongside saved bands', async () => {
  const { rows: [view] } = await db.query<{ id: string; pattern_id: string; maker_id: string }>(
    'SELECT v.id, p.id AS pattern_id, p.maker_id FROM pattern_views v JOIN patterns p ON p.id=v.pattern_id LIMIT 1');
  const { rows: [batch] } = await db.query<{id: string}>(`INSERT INTO ingestion_batches
    (maker_id,source_type,source_descriptor,created_by) VALUES ($1,'csv_upload','editions.csv',gen_random_uuid()) RETURNING id`, [view.maker_id]);
  const {rows:[savedBand]} = await db.query<{id:string;band_label:string;product_url:string}>(
    'SELECT id, band_label, product_url FROM pattern_size_bands WHERE pattern_id=$1 LIMIT 1',[view.pattern_id]);
  await db.query('UPDATE pattern_size_bands SET external_product_id=NULL WHERE id=$1',[savedBand.id]);
  const extra = { externalProductId: 'missing-1', bandLabel: savedBand.band_label, isDefault: false,
    productUrl: 'https://studio.example/item', priceCents: 1550, currency: 'USD', designerSizeLabel: '18–28',
    bustMinIn: 44, bustMaxIn: null, hipMinIn: null, hipMaxIn: null };
  await db.query(`INSERT INTO ingestion_items (batch_id,external_ref,item_key,pattern_id,stage,review_flags,raw_payload)
    VALUES ($1,'edition','edition',$2,'ready_for_review',ARRAY['missing_measurements'],$3)`,
    [batch.id, view.pattern_id, JSON.stringify({sizeBands: [
      {...extra, externalProductId:'matched-by-url',productUrl:savedBand.product_url}, extra,
    ], descriptionHtml:'Supplied size chart'})]);
  expect((await listQueue(db)).find(row => row.id === view.id)?.flags).toContain('missing_measurements');
  const editor = await getEditor(db, view.id);
  expect(editor!.bands).toContainEqual(extra);
  expect(editor!.bands.find(band => band.id === savedBand.id)?.externalProductId).toBe('matched-by-url');
  expect(editor!.sources[0].raw_payload.descriptionHtml).toBe('Supplied size chart');
  expect(editor!.targets.every(target => target.id !== view.pattern_id)).toBe(true);
});

it('records opt-in and tracking details, and guards concurrent maker edits', async () => {
  const form = new FormData();
  for (const [k,v] of Object.entries({name:'Test maker',slug:'test-maker',storefront_url:'https://atelier.example',
    platform_type:'shopify',vetted_status:'approved',utm_campaign_slug:'studio'})) form.set(k,v);
  await expect(saveMaker(db,form)).rejects.toThrow(/permission/i);
  form.set('permission_evidence_note','Written permission from the founder');
  form.set('affiliate_query_param','ref=studio');
  await saveMaker(db,form);
  const {rows:[m]}=await db.query<{id:string; revision:string}>("SELECT id,updated_at::text AS revision FROM makers WHERE slug='test-maker'");
  form.set('id',m.id);
  form.set('revision',m.revision);
  form.set('vetted_status','suspended');
  await saveMaker(db,form);
  await expect(saveMaker(db,form)).rejects.toThrow(/changed/i);
  expect((await db.query("SELECT vetted_status, affiliate_query_param FROM makers WHERE id=$1",[m.id])).rows[0])
    .toEqual({vetted_status:'suspended',affiliate_query_param:'ref=studio'});
});
