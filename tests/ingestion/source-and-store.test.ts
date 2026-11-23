import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { createCatalogMediaWriter, fetchApprovedShopifyDrafts } from '@/modules/ingestion/production';
import type { Queryable } from '@/lib/db';

it('checks maker permission and confines Shopify feed requests and redirects to its approved storefront', async () => {
  const body = async function* () { yield Buffer.from('{"products":[]}'); };
  const transport = {
    resolve:vi.fn(async()=>[{address:'93.184.216.34',family:4}]),
    request:vi.fn(async()=>({status:200,headers:new Headers(),body:body(),cancel() {}})),
  };
  const query = vi.fn().mockResolvedValue({rows:[]});
  const db = { query } as Queryable;
  await expect(fetchApprovedShopifyDrafts(db,'maker',undefined,transport)).rejects.toThrow(/approved/);
  expect(transport.resolve).not.toHaveBeenCalled();
  query.mockResolvedValue({rows:[{storefront_url:'https://maker.example'}]});
  expect(await fetchApprovedShopifyDrafts(db,'maker',undefined,transport)).toEqual([]);
  const request = transport.request as ReturnType<typeof vi.fn>;
  expect(request.mock.calls[0][0].href).toBe('https://maker.example/products.json?limit=250');
  request.mockResolvedValue({status:302,headers:new Headers({location:'https://other.example/products.json'}),body:body(),cancel(){}});
  await expect(fetchApprovedShopifyDrafts(db,'maker',undefined,transport)).rejects.toThrow();
  expect(transport.resolve).toHaveBeenCalledTimes(2);
});

it('writes to the configured bucket, accepts an existing object, and surfaces storage failures', async () => {
  const fetcher = vi.fn(async () => new Response('{"Key":"media/maker/test.webp"}',{status:200}));
  const client = createClient('https://storage.example','local-fixture',{global:{fetch:fetcher}});
  const write = createCatalogMediaWriter(client, 'media');
  expect(await write('maker/test.webp',Buffer.from('image'))).toBe('media/maker/test.webp');
  fetcher.mockResolvedValue(new Response('{"error":"Duplicate","message":"The resource already exists","statusCode":"409"}',{status:400}));
  expect(await write('maker/test.webp',Buffer.from('image'))).toBe('media/maker/test.webp');
  fetcher.mockResolvedValue(new Response('{"code":"ResourceLocked","message":"Try again","statusCode":"409"}',{status:409}));
  await expect(write('maker/test.webp',Buffer.from('image'))).rejects.toThrow();
  fetcher.mockResolvedValue(new Response('{"error":"Forbidden","message":"access denied","statusCode":"403"}',{status:403}));
  await expect(write('maker/test.webp',Buffer.from('image'))).rejects.toThrow();
});

it('imports all paged collection results and supports a single product URL', async () => {
  const db = {query:vi.fn().mockResolvedValue({rows:[{storefront_url:'https://maker.example'}]})} as Queryable;
  const resolve = async () => [{address:'93.184.216.34',family:4}];
  const request = vi.fn(async (url: URL) => {
    const second = url.searchParams.has('page_info');
    const single = url.pathname === '/products/elm.json';
    const product = {id:second ? 2 : 1,title:'Elm - ' + (second ? 'Curve' : 'Straight'),handle:'elm'+(second ? '2' : '1')};
    const headers = new Headers();
    if (!single && !second) headers.set('link', '</collections/dresses/products.json?page_info=more>; rel="next"');
    const payload = single ? {product} : {products:[product]};
    return {status:200,headers,body:(async function*(){yield Buffer.from(JSON.stringify(payload));})(),cancel(){}};
  });
  const deps = {resolve,request};
  const result = await fetchApprovedShopifyDrafts(db,'maker','/collections/dresses',deps);
  expect(result[0].sizeBands.map(band=>band.externalProductId)).toEqual(['1','2']);
  expect((await fetchApprovedShopifyDrafts(db,'maker','/products/elm',deps))[0].title).toBe('Elm');
});

it('provisions the default read bucket in Supabase and preserves an existing bucket configuration', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile('supabase/migrations/202611220004_ingestion_claims.sql', 'utf8');
  const block = sql.slice(sql.indexOf('DO $bucket$'));
  const db = new PGlite();
  try {
    await db.exec(block);
    await db.exec('CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean)');
    await db.exec(block);
    expect((await db.query('SELECT * FROM storage.buckets')).rows).toEqual([{id:'catalog-media', name:'catalog-media', public:true}]);
    await db.exec("UPDATE storage.buckets SET public=false WHERE id='catalog-media'");
    await db.exec(block);
    expect((await db.query('SELECT public FROM storage.buckets')).rows).toEqual([{public:false}]);
  } finally {
    await db.close();
  }
});

it('keeps demo Shopify imports on the bundled Maison Verveine feed', async () => {
  vi.stubEnv('SEAMLENS_LOCAL_DEMO', '1');
  vi.stubEnv('DATABASE_URL', 'postgres://demo:fixture@127.0.0.1:5432/seamlens_demo');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3101');
  vi.stubEnv('VERCEL', undefined);
  const query = vi.fn().mockResolvedValue({ rows: [{ storefront_url: 'https://maisonverveine.example' }] });
  const db = { query } as Queryable;
  const offline = () => { throw new Error('Unexpected network access'); };
  const transport = { resolve: offline, request: offline };
  try {
    const products = await fetchApprovedShopifyDrafts(db, 'maker', '/collections/demo', transport);
    expect(products).toMatchObject([{
      title: 'Demo Tansy Bishop Blouse',
      sizeBands: [{ productUrl: 'https://maisonverveine.example/products/demo-tansy-bishop-blouse' }],
      imageUrls: [{ url: 'https://demo.seamlens.test/samples/05-raglan-bishop.webp' }],
    }]);
    await expect(fetchApprovedShopifyDrafts(db, 'maker', '/products/demo-tansy-bishop-blouse', transport))
      .resolves.toEqual(products);
    await expect(fetchApprovedShopifyDrafts(db, 'maker', 'https://another.example/products.json', transport))
      .rejects.toThrow(/demo/i);
    await expect(fetchApprovedShopifyDrafts(db, 'maker', '/collections/not-in-demo', transport))
      .rejects.toThrow(/demo/i);
    query.mockResolvedValue({ rows: [{ storefront_url: 'https://another.example' }] });
    await expect(fetchApprovedShopifyDrafts(db, 'maker', undefined, transport)).rejects.toThrow(/demo/i);
  } finally {
    vi.unstubAllEnvs();
  }
});
