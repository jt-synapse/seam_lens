import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { DEMO_REFERENCE_URL, DEMO_SHOPIFY_IMAGE_URL } from '../../src/lib/local-demo-fixtures';

const host = '127.0.0.1';
const sampleWebpPath = new URL(DEMO_REFERENCE_URL).pathname;
const sampleJpgPath = sampleWebpPath.replace(/\.webp$/, '.jpg');
const secondSamplePath = new URL(DEMO_SHOPIFY_IMAGE_URL).pathname;
const csvPath = '/samples/maison-verveine.csv';
const csvTitle = 'Demo Alder Cowl Dress';
const csv = [
  'title,product_url,description_html,garment_category,substrate_type,skill_level,formats,view_code,view_label,cover_image_url,band_label,price,currency,designer_size_label,bust_min_in,bust_max_in,hip_min_in,hip_max_in',
  `${csvTitle},https://maisonverveine.example/products/demo-alder-cowl-dress,A sleeveless woven bias dress with a draped cowl neckline.,dress,woven,intermediate,pdf_a4_letter,cowl,Cowl view,${DEMO_REFERENCE_URL},Standard,16.00,USD,0–22,32,48,35,52`,
].join('\r\n') + '\r\n';
const catalogKey = /^(?:[a-z0-9][a-z0-9_-]{0,127}\/){3}(?:cover|flat_front|flat_back)-[a-f0-9]{64}-(?:card|full)\.webp$/i;
const sessionSeconds = 3600;

type DemoServiceOptions = {
  appUrl: string;
  port: number;
  admin: { id: string; email: string; password: string };
  serviceRoleKey: string;
  catalogBucket?: string;
};

function send(status: number, type: string, body: string | Buffer, headers = {}) {
  return new Response(typeof body === 'string' ? body : new Uint8Array(body), {
    status,
    headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...headers },
  });
}

function json(status: number, data: unknown) {
  return send(status, 'application/json; charset=utf-8', JSON.stringify(data));
}

async function readBody(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      length += next.value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Request is too large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function escapeHtml(value: string) {
  const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, char => escapes[char]);
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · SeamLens Studio</title><style>
:root{color-scheme:light;--ink:#26241f;--paper:#fbf8f1;--muted:#5e574d;--border:#ded5c7;--wine:#692f42}
*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--paper);font:16px/1.56 system-ui,-apple-system,sans-serif}
main{max-width:960px;margin:auto;padding:clamp(24px,6vw,80px) clamp(20px,5vw,56px)}
header{border-bottom:1px solid var(--border);padding-bottom:2rem}h1,h2{font-family:Georgia,serif;line-height:1.08;font-weight:400;margin:0}
h1{font-size:clamp(2.6rem,7vw,4.3rem)}h2{font-size:1.85rem}p{margin:.7rem 0 1rem}p:last-child{margin-bottom:0}
.eyebrow{color:var(--wine);font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin:0 0 .75rem}
header p:not(.eyebrow){max-width:62ch;color:var(--muted)}.actions{display:flex;gap:.7rem 1rem;flex-wrap:wrap;margin-top:1.3rem}
a{color:var(--wine);text-underline-offset:3px}a.button{border:1px solid var(--wine);border-radius:4px;padding:.58rem .85rem;font-weight:650;text-decoration:none}a.primary{background:var(--wine);color:white}
a:focus-visible{outline:2px solid var(--wine);outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin-top:1rem}
section{min-width:0;border:1px solid var(--border);border-radius:8px;padding:1.35rem;background:#fffdf8}.reference{display:flex;align-items:center;gap:1rem}.reference img{width:90px;max-width:28%;height:auto;border-radius:4px}.reference p{margin:.4rem 0}
code{font-size:.9em;overflow-wrap:anywhere;background:#f2ebdf;border-radius:3px;padding:2px 4px;user-select:all}dl{margin:1rem 0}dt{font-weight:650}dd{margin:0 0 .65rem}ol{padding-left:1.3rem;margin:1rem 0 0}li+li{margin-top:.5rem}
@media(max-width:650px){.grid{grid-template-columns:1fr}}
</style></head><body><main>${body}</main></body></html>`;
}

function guide(appUrl: string, admin: DemoServiceOptions['admin']) {
  return page('Demo guide', `
<header><p class="eyebrow">SeamLens Studio</p><h1>Local demo guide</h1>
<p>Explore sewing patterns and curate a fictional maker catalog. This demo uses a disposable local database and bundled fixtures. It makes no external calls.</p>
<nav class="actions" aria-label="Demo entry points"><a class="button primary" href="${appUrl}/">Open pattern search</a><a class="button" href="${appUrl}/admin/login">Open curator sign-in</a></nav></header>
<div class="grid">
<section><h2>Find a pattern</h2>
<p>Start with a <a href="${appUrl}/#archetypes">curated silhouette</a> or try this cowl-neck reference in <a href="${appUrl}/#upload">photo search</a>. Compare matches, change the part focus and open a maker preview from a result card.</p>
<div class="reference"><img src="${sampleWebpPath}?view=1" alt="Drawing of a floral cowl-neck dress" width="90"><div><p>Download reference</p><a href="${sampleJpgPath}">JPG</a> · <a href="${sampleWebpPath}">WebP</a></div></div>
<p>To try <strong>Image URL</strong>, paste <code>${DEMO_REFERENCE_URL}</code>.</p>
<p>The demo model uses saved construction profiles for recognized samples. Other uploads use the sample cowl dress profile. Search and filters use the local catalog.</p></section>
<section><h2>Curate the catalog</h2>
<dl><dt>Email</dt><dd><code>${escapeHtml(admin.email)}</code></dd><dt>Password</dt><dd><code>${escapeHtml(admin.password)}</code></dd></dl>
<p><a href="${csvPath}">Download the sample CSV</a></p>
<ol><li>Sign in and open <a href="${appUrl}/admin/imports">Imports</a>. Choose <strong>Maison Verveine</strong> in the CSV panel and upload the sample.</li>
<li>Open <strong>${csvTitle}</strong> from the completed batch.</li>
<li>Review the construction and measurements, select <strong>Save &amp; Re-Embed</strong>, then select <strong>Publish</strong>.</li>
<li>Search the cowl reference again and follow the new pattern’s maker link. Select <strong>Takedown</strong> in the editor, then open <a href="${appUrl}/admin/telemetry">Telemetry</a> to see recorded search and click activity.</li></ol>
<p>To try the Shopify fixture, choose <strong>Maison Verveine</strong> in the Shopify panel, leave the URL blank and select <strong>Import from Shopify</strong>.</p></section>
</div>`);
}

function makerPreview(appUrl: string, url: URL) {
  const [, , makerPath, productPath] = url.pathname.split('/');
  const fromPath = (value?: string) => value ? decodeURIComponent(value).replace(/-/g, ' ') : undefined;
  const maker = escapeHtml(url.searchParams.get('maker') || fromPath(makerPath) || 'Demo maker');
  const product = escapeHtml(url.searchParams.get('product') || fromPath(productPath) || 'Demo pattern');
  const band = url.searchParams.get('band');
  return page('Maker preview', `<header><p class="eyebrow">Local maker preview</p><h1>${product}</h1>
<p>Maker · ${maker}</p>${band ? `<p>Selected size band · ${escapeHtml(band)}</p>` : ''}
<p>This fictional listing is part of the SeamLens demo.</p>
<nav class="actions" aria-label="Demo navigation"><a class="button primary" href="${appUrl}/">Back to pattern search</a><a class="button" href="/">Demo guide</a></nav></header>`);
}

export async function createDemoServiceFetch(options: Omit<DemoServiceOptions, 'port'>): Promise<typeof fetch> {
  const { admin, serviceRoleKey, catalogBucket = 'catalog-media' } = options;
  const app = new URL(options.appUrl);
  if (app.protocol !== 'http:' || ![host, 'localhost'].includes(app.hostname) || app.username || app.password) {
    throw new Error(`The demo app URL must use HTTP on ${host}`);
  }
  const appUrl = app.origin;
  const [webp, bishop] = await Promise.all([
    readFile(new URL('../../eval/fixtures/smoke-v1/images/01-floral-cowl.webp', import.meta.url)),
    readFile(new URL('../../eval/fixtures/smoke-v1/images/05-raglan-bishop.webp', import.meta.url)),
  ]);
  const jpeg = await sharp(webp).jpeg({ quality: 92 }).toBuffer();
  const guideHtml = guide(appUrl, admin);
  const objects = new Map<string, Buffer>();
  const secret = randomBytes(32);
  const user = {
    id: admin.id, aud: 'authenticated', role: 'authenticated', email: admin.email,
    created_at: new Date().toISOString(), user_metadata: {}, app_metadata: { provider: 'email', providers: ['email'] },
  };
  const sessionByAccess = new Map<string, { refresh: string; expiresAt: number }>();
  const accessByRefresh = new Map<string, string>();
  const now = () => Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  function revoke(access: string) {
    const session = sessionByAccess.get(access);
    if (session) accessByRefresh.delete(session.refresh);
    sessionByAccess.delete(access);
  }

  function issueSession() {
    const iat = now();
    const expiresAt = iat + sessionSeconds;
    const claims = encode({ sub: user.id, role: user.role, aud: user.aud, exp: expiresAt, iat, jti: randomUUID() });
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${claims}`;
    const access = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
    const refresh = randomUUID();
    sessionByAccess.set(access, { refresh, expiresAt });
    accessByRefresh.set(refresh, access);
    return { access_token: access, refresh_token: refresh, expires_in: sessionSeconds, expires_at: expiresAt, token_type: 'bearer', user };
  }

  const writePrefix = `/storage/v1/object/${catalogBucket}/`;
  const readPrefix = `/storage/v1/object/public/${catalogBucket}/`;
  const notFound = () => json(404, { message: 'Demo route not found' });

  async function route(request: Request) {
    const target = new URL(request.url);
    const { pathname, searchParams } = target;
    const get = request.method === 'GET';
    const post = request.method === 'POST';
    const access = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1] ?? '';
    const authenticated = (sessionByAccess.get(access)?.expiresAt ?? 0) > now();

    if (post && pathname === '/auth/v1/token') {
      const raw = await readBody(request, 8192);
      const credentials = JSON.parse(raw.toString()) as { email?: string; password?: string; refresh_token?: string } | null;
      const grant = searchParams.get('grant_type');
      if (grant === 'password' && credentials?.email === admin.email && credentials.password === admin.password) {
        return json(200, issueSession());
      }
      if (grant === 'refresh_token') {
        const currentAccess = accessByRefresh.get(credentials?.refresh_token ?? '');
        if (currentAccess) {
          revoke(currentAccess);
          return json(200, issueSession());
        }
      }
      return json(400, { message: 'Invalid sign-in or refresh token' });
    }
    if (get && pathname === '/auth/v1/user') {
      return authenticated ? json(200, user) : json(401, { message: 'Signed out', code: 'session_not_found' });
    }
    if (post && pathname === '/auth/v1/logout') {
      revoke(access);
      return json(200, {});
    }
    if (post && pathname === '/rest/v1/rpc/is_seamlens_admin') return json(200, authenticated);

    if (post && pathname.startsWith(writePrefix)) {
      if (access !== serviceRoleKey) return json(403, { message: 'A demo service role is required' });
      const key = pathname.slice(writePrefix.length);
      if (!catalogKey.test(key) || request.headers.get('content-type') !== 'image/webp' || request.headers.get('x-upsert') === 'true') {
        return json(400, { message: 'Expected a generated catalog WebP object' });
      }
      const bytes = await readBody(request, 6 * 1024 * 1024);
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') {
        return json(400, { message: 'Expected WebP image bytes' });
      }
      if (objects.has(key)) return json(409, { code: 'ResourceAlreadyExists', message: 'Object already exists' });
      objects.set(key, bytes);
      return json(200, { Key: `${catalogBucket}/${key}`, Id: randomUUID() });
    }
    if (get && pathname.startsWith(readPrefix)) {
      const bytes = objects.get(pathname.slice(readPrefix.length));
      return bytes ? send(200, 'image/webp', bytes) : notFound();
    }
    if (get && pathname === '/') return send(200, 'text/html; charset=utf-8', guideHtml);
    if (get && (pathname === '/maker' || pathname.startsWith('/maker/'))) {
      return send(200, 'text/html; charset=utf-8', makerPreview(appUrl, target));
    }
    if (get && pathname === csvPath) {
      return send(200, 'text/csv; charset=utf-8', csv, { 'content-disposition': 'attachment; filename="maison-verveine.csv"' });
    }
    if (get && pathname === secondSamplePath) return send(200, 'image/webp', bishop);
    if (get && (pathname === sampleWebpPath || pathname === sampleJpgPath)) {
      const isJpeg = pathname.endsWith('.jpg');
      const disposition = searchParams.has('view') ? 'inline' : 'attachment';
      return send(200, isJpeg ? 'image/jpeg' : 'image/webp', isJpeg ? jpeg : webp, {
        'content-disposition': `${disposition}; filename="${pathname.slice('/samples/'.length)}"`,
      });
    }
    return notFound();
  }

  return async (input, init) => {
    try {
      return await route(new Request(input, init));
    } catch {
      return json(400, { message: 'Invalid demo request' });
    }
  };
}

export async function startDemoServices(options: DemoServiceOptions) {
  const handle = await createDemoServiceFetch(options);
  let url: string;
  let authority: string;
  const server = createServer(async (request, response) => {
    try {
      const target = new URL(request.url ?? '/', url);
      if (request.headers.host !== authority || target.origin !== url) {
        response.writeHead(403).end('Use the local demo address');
        return;
      }
      const method = request.method ?? 'GET';
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const init: RequestInit & { duplex?: 'half' } = { method, headers };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const result = await handle(target, init);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!response.headersSent) response.writeHead(400).end('Invalid demo request');
    }
  });
  server.listen(options.port, host);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The demo service could not bind a loopback port');
  authority = `${host}:${address.port}`;
  url = `http://${authority}`;
  return {
    url,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
