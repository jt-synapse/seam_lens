import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import * as database from '@/lib/db';
import * as vision from '@/modules/vision/gemini-vision-extractor';
import * as embeddings from '@/modules/vision/gemini-text-embedder';
import { BudgetExceededError } from '@/modules/vision/usage-ledger';
import * as ingest from '@/modules/search/image-ingest';
import * as http from '@/modules/search/public-http';
import { deterministicTextToVector768, seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';
import { listActiveArchetypes } from '@/modules/catalog/archetypes-repo';
import { buildTrackedDestinationUrl } from '@/modules/catalog/outbound-url';
import { POST as analyze } from '@/app/api/v1/search/analyze/route';
import { POST as query } from '@/app/api/v1/search/query/route';
import { GET as go } from '@/app/go/[pattern_id]/route';
import { buildPreparedUploadForm, preprocessGarmentFileInBrowser } from '@/modules/search/client-canvas-preprocess';

const { scheduled } = vi.hoisted(() => ({ scheduled: [] as (() => Promise<void>)[] }));
vi.mock('next/server', async (original) => ({
  ...await original<typeof import('next/server')>(), after: (fn: () => Promise<void>) => scheduled.push(fn),
}));

let db: PGlite;
let image: Buffer;
const slug = 'square-neck-puff-midi';
const address = '203.0.113.10';
const headers = { 'x-vercel-forwarded-for': address, 'x-forwarded-for': '198.51.100.10' };
function json(data: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(data),
  });
}
function upload(form: FormData) {
  return new Request('http://localhost/api', { method: 'POST', headers, body: form });
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code, message: expect.any(String) });
}
const buckets = async () => (await db.query(
  'SELECT bucket, sum(hit_count)::int AS hits FROM rate_limit_windows GROUP BY bucket ORDER BY bucket',
)).rows;
const sessionCount = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM query_sessions')).rows[0].n;

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  for (const name of ['202611220001_init_seamlens_v1.sql', '202611220002_catalog_integrity.sql', '202611220003_ai_budget.sql', '202611220007_search_session_crop.sql', '202611220008_model_provenance.sql']) {
    await db.exec(await readFile(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8'));
  }
  await seedSyntheticCatalog(db);
  image = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#cc3322' } })
    .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 3, background: '#1166ee' } }).png().toBuffer(), left: 40, top: 0 }])
    .png().toBuffer();
}, 30000);
beforeEach(async () => {
  vi.stubEnv('RATE_LIMIT_IP_SALT', 'deployment-secret');
  vi.stubEnv('VERCEL', '1');
  vi.spyOn(database, 'getDbPool').mockReturnValue(db);
  vi.spyOn(vision, 'createGeminiVisionExtractor').mockImplementation(() => { throw new Error('unexpected provider'); });
  vi.spyOn(embeddings, 'createGeminiTextEmbedder').mockImplementation(() => { throw new Error('unexpected provider'); });
  scheduled.length = 0;
  await db.exec('TRUNCATE rate_limit_windows, query_sessions, search_events, outbound_clicks, api_usage_ledger');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => db?.close());

async function useDressModelFixture() {
  const { rows: [archetype] } = await db.query<{ extracted_profile: import('@/modules/taxonomy/construction-profile').ConstructionProfileV1 }>(
    'SELECT extracted_profile FROM curated_archetypes WHERE slug = $1', [slug]);
  vi.mocked(vision.createGeminiVisionExtractor).mockReturnValue({ extract: async () => ({
    status: 'ok', profile: archetype.extracted_profile, warnings: [], aiConfidence: 1, inputTokens: 1, outputTokens: 1,
  }) });
  const v = deterministicTextToVector768('bodice');
  vi.mocked(embeddings.createGeminiTextEmbedder).mockReturnValue({ embedRegions: async () => ({
    vectors: { full: v, bodice: v, sleeves: v, skirt: v }, inputTokens: 1,
  }) });
}

it('creates one session from a cold URL and reuses it for a file with no provider construction on cache hit', async () => {
  await useDressModelFixture();
  vi.spyOn(ingest, 'fetchDirectImageUrlSafe').mockResolvedValue(Buffer.from(image));
  const first = await analyze(json({ imageUrl: 'https://maker.example/dress.png' }));
  expect(first.status).toBe(200);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(image)]), 'dress.png');
  const second = await analyze(upload(form));
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual(await first.json());
  expect(await sessionCount()).toBe(1);
  expect(await buckets()).toEqual([{ bucket: 'analyze_hr', hits: 2 }, { bucket: 'analyze_min', hits: 2 }]);
  const { rows } = await db.query('SELECT DISTINCT subject_hash FROM rate_limit_windows');
  expect(rows).toEqual([{ subject_hash: createHmac('sha256', 'deployment-secret').update(address).digest('hex') }]);
});

it('searches active archetypes and refines at the daily cap with only the read bucket', async () => {
  await db.exec("INSERT INTO api_usage_ledger (operation, estimated_cost_usd) VALUES ('search_vision', 100) ON CONFLICT DO NOTHING");
  const cards = await listActiveArchetypes(db);
  expect(cards[0]).toMatchObject({ slug, imageUrl: '/catalog-media/archetypes/square-neck-puff-midi.webp' });
  const first = await analyze(json({ archetypeSlug: slug }));
  expect(first.status).toBe(200);
  const { querySessionId, results } = await first.json();
  expect(results[0].title).toMatch(/Sol[eè]ne/i);
  const refined = await query(json({ querySessionId, focusRegion: 'bodice_neckline', filters: { userBustIn: 52 } }));
  expect(refined.status).toBe(200);
  const refinement = await refined.json();
  expect(refinement.querySessionId).toBe(querySessionId);
  expect(refinement.results.length).toBeGreaterThan(0);
  expect(refinement.results.some((card: { garmentCategory: string }) => card.garmentCategory === 'top')).toBe(true);
  expect(await buckets()).toEqual([{ bucket: 'query_min', hits: 2 }]);
  expect(await sessionCount()).toBe(1);
  const cold = new FormData();
  cold.set('file', new Blob([new Uint8Array(image)]), 'cold.png');
  await expectError(await analyze(upload(cold)), 503, 'BUDGET_EXCEEDED');
  expect(vision.createGeminiVisionExtractor).not.toHaveBeenCalled();
  await db.query("UPDATE query_sessions SET expires_at = now() - interval '1 second'");
  await expectError(await query(json({ querySessionId })), 404, 'SESSION_EXPIRED');
  await db.query('UPDATE curated_archetypes SET active = false WHERE slug = $1', [slug]);
  try {
    expect((await listActiveArchetypes(db)).map(item => item.slug)).not.toContain(slug);
    await expectError(await analyze(json({ archetypeSlug: slug })), 404, 'ARCHETYPE_UNAVAILABLE');
  } finally {
    await db.query('UPDATE curated_archetypes SET active = true WHERE slug = $1', [slug]);
  }
});

it('validates exclusive sources, typed fields and crop bounds before debit', async () => {
  for (const data of [{}, { file: 'bad' }, { archetypeSlug: slug, imageUrl: 'https://example.com/image' },
    { archetypeSlug: slug, filters: { skills: ['invalid'] } }, { archetypeSlug: slug, filters: { userBustIn: -1 } },
    { archetypeSlug: slug, focusRegion: 'skirt' },
    { imageUrl: 'https://example.com/image', cropBox: { x: 0.7, y: 0, width: 0.4, height: 1 } }]) {
    await expectError(await analyze(json(data)), 400, 'INVALID_INPUT');
  }
  const form = new FormData();
  form.append('file', new Blob(['foo']), 'a.jpg');
  form.append('archetypeSlug', slug);
  await expectError(await analyze(upload(form)), 400, 'INVALID_INPUT');
  form.delete('archetypeSlug');
  form.set('cropApplied', 'true');
  form.set('cropBox', JSON.stringify({ x:0, y:0, width:0.5, height:1 }));
  await expectError(await analyze(upload(form)), 400, 'INVALID_INPUT');
  await expectError(await query(json({ querySessionId: 'abc' })), 400, 'INVALID_INPUT');
  expect(await buckets()).toEqual([]);
});

it('caps actual multipart bytes and maps image, URL, and spend failures', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(4_500_000)]), 'large.jpg');
  await expectError(await analyze(upload(form)), 413, 'IMAGE_TOO_LARGE');
  form.set('file', new Blob(['not a garment image']), 'invalid.png');
  await expectError(await analyze(upload(form)), 415, 'UNSUPPORTED_IMAGE_FORMAT');
  vi.spyOn(ingest, 'fetchDirectImageUrlSafe').mockRejectedValueOnce(new ingest.SearchError('HTML_PAGE_URL_UNSUPPORTED', 422));
  await expectError(await analyze(json({ imageUrl: 'https://example.com/product' })), 422, 'HTML_PAGE_URL_UNSUPPORTED');
  form.set('file', new Blob([new Uint8Array(image)]), 'good.png');
  vi.mocked(vision.createGeminiVisionExtractor).mockReturnValue({ extract: async () => { throw new BudgetExceededError(); } });
  await expectError(await analyze(upload(form)), 503, 'BUDGET_EXCEEDED');
});

it('throttles using the platform identity even when ordinary forwarded headers change', async () => {
  const form = new FormData();
  form.set('file', new Blob(['bad']), 'invalid.png');
  for (let i = 0; i < 10; i++) {
    const req = upload(form);
    req.headers.set('x-forwarded-for', '198.51.100.' + i);
    expect((await analyze(req)).status).toBe(415);
  }
  const response = await analyze(upload(form));
  expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
  await expectError(response, 429, 'RATE_LIMITED');
  expect((await analyze(json({ archetypeSlug: slug }))).status).toBe(200);
});

it('enforces the hourly cap atomically and shares the read cap across both routes', async () => {
  const form = new FormData();
  form.set('file', new Blob(['bad']), 'invalid.png');
  expect((await analyze(upload(form))).status).toBe(415);
  await db.exec("UPDATE rate_limit_windows SET hit_count=40 WHERE bucket='analyze_hr'");
  const rejected = await analyze(upload(form));
  await expectError(rejected, 429, 'RATE_LIMITED');
  expect(await buckets()).toEqual([{ bucket: 'analyze_hr', hits: 40 }, { bucket: 'analyze_min', hits: 1 }]);
  const { querySessionId } = await (await analyze(json({ archetypeSlug: slug }))).json();
  await db.exec("UPDATE rate_limit_windows SET hit_count=119 WHERE bucket='query_min'");
  expect((await query(json({ querySessionId }))).status).toBe(200);
  await expectError(await analyze(json({ archetypeSlug: slug })), 429, 'RATE_LIMITED');
  await expectError(await query(json({ querySessionId })), 429, 'RATE_LIMITED');
  expect(await sessionCount()).toBe(1);
});

it('requires a deployment salt in production and ignores client headers off-platform', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('RATE_LIMIT_IP_SALT', '');
  await expectError(await analyze(json({ archetypeSlug: slug })), 503, 'SEARCH_UNAVAILABLE');
  vi.stubEnv('RATE_LIMIT_IP_SALT', 'self-hosted-secret');
  vi.stubEnv('VERCEL', '');
  for (const ip of ['192.0.2.1', '192.0.2.2']) {
    expect((await analyze(json({ archetypeSlug: slug }, { 'x-vercel-forwarded-for': ip }))).status).toBe(200);
  }
  expect((await db.query('SELECT DISTINCT subject_hash FROM rate_limit_windows')).rows).toHaveLength(1);
});

it('merges maker URLs, logs the selected band once after the response, and respects takedowns', async () => {
  const { rows: [owner] } = await db.query<{ id: string; maker_id: string; view_id: string; band_id: string; default_band_id: string }>(
    "SELECT p.id, p.maker_id, v.id view_id, b.id band_id, d.id default_band_id FROM patterns p JOIN pattern_views v ON v.pattern_id=p.id AND v.is_primary_view JOIN pattern_size_bands b ON b.pattern_id=p.id AND NOT b.is_default JOIN pattern_size_bands d ON d.pattern_id=p.id AND d.is_default WHERE p.slug='solene-square-puff-midi-dress'");
  const { rows: [other] } = await db.query<{ view_id: string; band_id: string }>(
    'SELECT v.id view_id, b.id band_id FROM pattern_views v JOIN pattern_size_bands b ON b.pattern_id=v.pattern_id WHERE v.pattern_id <> $1 LIMIT 1', [owner.id]);
  await db.query("UPDATE pattern_size_bands SET product_url = 'https://maisonverveine.example/products/solene-curve?variant=99#sizing' WHERE id=$1", [owner.band_id]);
  const goTo = (params: Record<string, string>) => go(new Request('http://localhost/go/' + owner.id + '?' + new URLSearchParams(params)),
    { params: Promise.resolve({ pattern_id: owner.id }) });
  const { querySessionId } = await (await analyze(json({ archetypeSlug: slug }))).json();
  const response = await goTo({ band: owner.band_id, v: owner.view_id, pos: '1', region: 'full_silhouette', q: querySessionId });
  expect(response.status).toBe(302);
  const url = new URL(response.headers.get('location')!);
  expect(url.origin + url.pathname + url.hash).toBe('https://maisonverveine.example/products/solene-curve#sizing');
  expect(Object.fromEntries(url.searchParams)).toEqual({ variant: '99', ref: 'seamlens', utm_source: 'seamlens', utm_medium: 'visual_search', utm_campaign: 'seamlens_v1' });
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect((await db.query('SELECT * FROM outbound_clicks')).rows).toHaveLength(0);
  expect(scheduled).toHaveLength(1);
  await scheduled.shift()!();
  expect((await db.query('SELECT * FROM outbound_clicks')).rows).toMatchObject([{
    pattern_id: owner.id, size_band_id: owner.band_id, pattern_view_id: owner.view_id, maker_id: owner.maker_id,
    query_session_id: querySessionId, rank_position: 1, focus_region: 'full_silhouette', destination_url: url.href,
  }]);
  const fallback = await goTo({ band: other.band_id, v: other.view_id });
  expect(fallback.status).toBe(302);
  expect(new URL(fallback.headers.get('location')!).pathname).not.toBe(url.pathname);
  await scheduled.shift()!();
  expect((await db.query('SELECT * FROM outbound_clicks WHERE size_band_id = $1', [owner.default_band_id])).rows)
    .toMatchObject([{ pattern_view_id: null }]);
  await db.query("UPDATE patterns SET status='unpublished' WHERE id=$1", [owner.id]);
  expect((await goTo({})).status).toBe(404);
  await db.query("UPDATE patterns SET status='published' WHERE id=$1", [owner.id]);
  await db.query("UPDATE makers SET vetted_status='suspended' WHERE id=$1", [owner.maker_id]);
  try { expect((await goTo({})).status).toBe(404); }
  finally { await db.query("UPDATE makers SET vetted_status='approved' WHERE id=$1", [owner.maker_id]); }
  for (const invalid of ['javascript:void(0)', '/relative', 'https://user@other.example/path']) {
    expect(() => buildTrackedDestinationUrl(invalid, 'test')).toThrow();
  }
});

it('rejects HEIC in the browser before decoding or uploading', async () => {
  await expect(preprocessGarmentFileInBrowser(new File(['x'], 'photo.HEIC'))).rejects.toThrow(/JPEG.*PNG.*WebP.*screenshot/i);
});

// A canvas adapter backed by sharp exercises the actual draw rectangle and encoder with asymmetric pixels.
it('submits the same right half as a server-side URL crop exactly once', async () => {
  const crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
  const bitmap = { width: 80, height: 40, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  let pixels = sharp(image);
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_: unknown, x: number, y: number, w: number, h: number) => {
      pixels = pixels.extract({ left: x, top: y, width: w, height: h });
    } }),
    toBlob: (done: (b: Blob) => void, type: string, quality: number) => {
      void pixels.resize(canvas.width, canvas.height).webp({ quality: Math.round(quality * 100) }).toBuffer()
        .then(bytes => done(new Blob([new Uint8Array(bytes)], { type })));
    },
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('FileReader', class {
    result = ''; onload = () => {};
    async readAsDataURL(b: Blob) { this.result = 'data:image/webp;base64,' + Buffer.from(await b.arrayBuffer()).toString('base64'); this.onload(); }
  });
  const { blob, previewDataUrl } = await preprocessGarmentFileInBrowser(new File([new Uint8Array(image)], 'two.png'), crop);
  expect(previewDataUrl).toMatch(/^data:image\/webp;base64,/);
  expect(bitmap.close).toHaveBeenCalled();
  expect(createImageBitmap).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' });
  const form = buildPreparedUploadForm(blob, 'bodice_neckline', { substrate: 'woven' });
  expect(form.get('cropBox')).toBeNull();
  expect(form.get('focusRegion')).toBe('bodice_neckline');
  expect(JSON.parse(String(form.get('filters')))).toEqual({ substrate: 'woven' });
  const uploaded = await ingest.validateAndNormalizeServerImage(Buffer.from(await (form.get('file') as Blob).arrayBuffer()));
  const remote = await ingest.validateAndNormalizeServerImage(image, crop);
  for (const result of [uploaded, remote]) {
    expect([result.width, result.height]).toEqual([40, 40]);
    const rgb = await sharp(result.webpBytes).raw().toBuffer();
    expect(rgb[2]).toBeGreaterThan(215);
    expect(rgb[0]).toBeLessThan(45);
  }
  await useDressModelFixture();
  vi.spyOn(ingest, 'fetchDirectImageUrlSafe').mockResolvedValue(Buffer.from(image));
  const browser = await (await analyze(upload(buildPreparedUploadForm(blob, 'full_silhouette', {})))).json();
  const url = await (await analyze(json({ imageUrl:'https://maker.example/photo.png', cropBox:crop }))).json();
  const categories = (result: { results: { garmentCategory: string }[] }) =>
    new Set(result.results.map(card => card.garmentCategory));
  expect(categories(url)).toEqual(new Set(['dress', 'top']));
  expect(categories(browser)).toEqual(categories(url));
  // The same bytes submitted as an entire photo retain the model's category filter.
  const whole = new FormData();
  whole.set('file', blob, 'whole.webp');
  const original = await (await analyze(upload(whole))).json();
  expect(original.querySessionId).not.toBe(browser.querySessionId);
  expect(categories(original)).toEqual(new Set(['dress']));
  const repeated = await (await analyze(upload(buildPreparedUploadForm(blob, 'full_silhouette', {})))).json();
  expect(repeated.querySessionId).toBe(browser.querySessionId);
});

it('reclaims expired sessions during archetype-only traffic while keeping active sessions', async () => {
  const first = await (await analyze(json({ archetypeSlug: slug }))).json();
  await db.query("UPDATE query_sessions SET expires_at=now()-interval '1 second' WHERE id=$1", [first.querySessionId]);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const second = await (await analyze(json({ archetypeSlug: slug }))).json();
  expect((await db.query('SELECT id FROM query_sessions')).rows).toEqual([{ id: second.querySessionId }]);
});

it('times live and refinement searches from before database admission', async () => {
  await useDressModelFixture();
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const admit = http.admitPublicSearch;
  vi.spyOn(http, 'admitPublicSearch').mockImplementation(async (...args) => {
    await admit(...args);
    clock += 240;
  });
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(image)]), 'photo.png');
  const { querySessionId } = await (await analyze(upload(form))).json();
  expect((await query(json({ querySessionId }))).status).toBe(200);
  const events = await db.query('SELECT source_type, latency_ms FROM search_events ORDER BY source_type');
  expect(events.rows).toEqual([
    { source_type:'filter_refinement', latency_ms:240 }, { source_type:'upload', latency_ms:240 },
  ]);
});
