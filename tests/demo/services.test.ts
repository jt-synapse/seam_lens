import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoServiceFetch } from '../../scripts/demo/services';
import { parseSeamLensCsv } from '../../src/modules/ingestion/parsers';

const appUrl = 'http://127.0.0.1:3100';
const admin = { id: '4ac6f000-eeee-4444-8888-123456789012', email: 'curator@example.test', password: 'test-password' };
const serviceRoleKey = 'test-service-role';
const serviceUrl = 'http://127.0.0.1:3101';
let demoFetch: typeof fetch;

beforeAll(async () => {
  demoFetch = await createDemoServiceFetch({ appUrl, admin, serviceRoleKey });
});

function cookieClient() {
  const cookies = new Map<string, string>();
  const client = () => createServerClient(serviceUrl, 'test-anon-key', {
    global: { fetch: demoFetch },
    cookies: {
      getAll: () => Array.from(cookies, ([name, value]) => ({ name, value })),
      setAll: (changes: Array<{ name: string; value: string; options: CookieOptions }>) => {
        for (const { name, value } of changes) {
          if (value) cookies.set(name, value);
          else cookies.delete(name);
        }
      },
    },
  });
  return { client, cookies };
}

describe('local demo services', () => {
  it('signs in, restores, refreshes and revokes an SSR curator session', async () => {
    const { client, cookies } = cookieClient();
    expect((await client().auth.signInWithPassword({ ...admin, password: 'incorrect' })).error?.status).toBe(400);
    expect(cookies.size).toBe(0);
    expect((await client().rpc('is_seamlens_admin')).data).toBe(false);

    const { data: signedIn, error } = await client().auth.signInWithPassword(admin);
    expect(error).toBeNull();
    expect(cookies.size).toBeGreaterThan(0);
    expect((await client().auth.getUser()).data.user?.id).toBe(admin.id);
    expect((await client().rpc('is_seamlens_admin')).data).toBe(true);

    const { data: refreshed, error: refreshError } = await client().auth.refreshSession();
    expect(refreshError).toBeNull();
    expect(refreshed.session?.refresh_token).not.toBe(signedIn.session?.refresh_token);
    expect((await client().auth.signOut({ scope: 'local' })).error).toBeNull();
    expect(cookies.size).toBe(0);
    expect((await client().auth.getUser(refreshed.session?.access_token)).error?.status).toBe(401);
    expect((await client().rpc('is_seamlens_admin')).data).toBe(false);
  });

  it('writes only namespaced WebP catalog objects with the service key and serves their public bytes', async () => {
    const serviceClient = createClient(serviceUrl, serviceRoleKey, { auth: { persistSession: false }, global: { fetch: demoFetch } });
    const anonClient = createClient(serviceUrl, 'test-anon-key', { auth: { persistSession: false }, global: { fetch: demoFetch } });
    const store = serviceClient.storage.from('catalog-media');
    const key = `maker/pattern/view/cover-${'a'.repeat(64)}-full.webp`;
    const bytes = await sharp({ create: { width: 3, height: 4, channels: 3, background: '#fef0e0' } }).webp().toBuffer();
    const options = { contentType: 'image/webp', upsert: false };
    expect((await anonClient.storage.from('catalog-media').upload(key, bytes, options)).error).not.toBeNull();
    expect((await serviceClient.storage.from('other').upload(key, bytes, options)).error).not.toBeNull();
    expect((await store.upload('anything.webp', bytes, options)).error).not.toBeNull();
    expect((await store.upload(key, Buffer.from('invalid image'), options)).error).not.toBeNull();
    expect((await store.upload(key, bytes, options)).error).toBeNull();
    expect((await store.upload(key, bytes, options)).error?.message).toMatch(/already exists/i);
    const publicUrl = store.getPublicUrl(key).data.publicUrl;
    const response = await demoFetch(publicUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect((await demoFetch(publicUrl.replace('full.webp', 'card.webp'))).status).toBe(404);
  });

  it('serves downloadable samples with a valid CSV draft and decodable images', async () => {
    const guide = await demoFetch(serviceUrl).then(response => response.text());
    expect(guide).toContain(`${appUrl}/admin/login`);
    expect(guide).toContain(`${appUrl}/#upload`);
    const csv = await demoFetch(`${serviceUrl}/samples/maison-verveine.csv`);
    expect(csv.headers.get('content-disposition')).toContain('attachment');
    const [draft] = parseSeamLensCsv(await csv.text());
    expect(draft.title).toBe('Demo Alder Cowl Dress');
    expect(draft.imageUrls).toEqual([{
      url: 'https://demo.seamlens.test/samples/01-floral-cowl.webp', roleHint: 'cover', viewCode: 'cowl',
    }]);
    expect(draft.sizeBands[0].productUrl).toBe('https://maisonverveine.example/products/demo-alder-cowl-dress');
    const second = await demoFetch(`${serviceUrl}/samples/05-raglan-bishop.webp`);
    expect((await sharp(Buffer.from(await second.arrayBuffer())).metadata()).format).toBe('webp');
    for (const [extension, format] of [['jpg', 'jpeg'], ['webp', 'webp']]) {
      const image = await demoFetch(`${serviceUrl}/samples/01-floral-cowl.${extension}`);
      expect(image.headers.get('content-type')).toBe(`image/${format}`);
      expect((await sharp(Buffer.from(await image.arrayBuffer())).metadata()).format).toBe(format);
    }
  });

  it('shows a local maker destination with safe display of query values', async () => {
    const params = new URLSearchParams({ maker: 'Maison Verveine', product: '<b>Demo & Alder</b>', band: 'Extended' });
    const response = await demoFetch(`${serviceUrl}/maker?${params}`, { redirect: 'manual' });
    expect(response.status).toBe(200);
    const destination = await response.text();
    expect(destination).toContain('Maison Verveine');
    expect(destination).toContain('&lt;b&gt;Demo &amp; Alder&lt;/b&gt;');
    expect(destination).toContain('Extended');
    expect(destination).not.toContain('<b>Demo');
  });
});
