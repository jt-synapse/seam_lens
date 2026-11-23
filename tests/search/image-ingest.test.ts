import { createHash } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { Readable } from 'node:stream';
import type { DetailedPeerCertificate } from 'node:tls';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchDirectImageUrlSafe,
  fetchPublicHttps,
  validateAndNormalizeServerImage,
  type SafeImageTransport,
} from '@/modules/search/image-ingest';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));

async function png() {
  return sharp({ create: { width: 12, height: 6, channels: 3, background: 'white' } }).png().toBuffer();
}

describe('image normalization', () => {
  it('uses upright dimensions and strips EXIF', async () => {
    const jpeg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: 'blue' } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await validateAndNormalizeServerImage(jpeg);
    const metadata = await sharp(result.webpBytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 800, height: 1200 });
    expect(metadata.exif).toBeUndefined();
    expect(result.sha256).toBe(createHash('sha256').update(result.webpBytes).digest('hex'));
  });

  it('crops the upright image using its displayed axes', async () => {
    const jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: 'blue' } })
      .composite([{ input: { create: { width: 120, height: 40, channels: 3, background: 'red' } }, top: 0, left: 0 }])
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await validateAndNormalizeServerImage(jpeg, { x: 0.5, y: 0, width: 0.5, height: 0.25 });
    expect(result).toMatchObject({ width: 40, height: 30 });
    const { data } = await sharp(result.webpBytes).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(data[2]);
  });

  it('accepts AVIF', async () => {
    const avif = await sharp(await png()).avif().toBuffer();
    await expect(validateAndNormalizeServerImage(avif)).resolves.toMatchObject({ width: 12, height: 6 });
  });

  it.each([Buffer.alloc(0), Buffer.from('0000ftypheic'), Buffer.from('0000ftypheix'), Buffer.from([255, 216, 255, 0])])(
    'rejects unsupported or malformed bytes',
    async (bytes) => {
      await expect(validateAndNormalizeServerImage(bytes)).rejects.toMatchObject({
        code: 'UNSUPPORTED_IMAGE_FORMAT', statusCode: 415,
      });
    },
  );

  it('rejects uploads larger than eight MiB', async () => {
    await expect(validateAndNormalizeServerImage(Buffer.alloc(8 * 1024 * 1024 + 1)))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', statusCode: 413 });
  });

  it('validates full decoded dimensions before applying a small crop', async () => {
    const source = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: 'white' } })
      .png().toBuffer();
    await expect(validateAndNormalizeServerImage(source, { x: 0, y: 0, width: 0.01, height: 0.01 }))
      .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', statusCode: 413 });
  });

  it.each([
    { x: 0, y: 0, width: NaN, height: 1 },
    { x: 0, y: -0.1, width: 1, height: 1 },
    { x: 0, y: 0, width: 1, height: 0 },
    { x: 0.8, y: 0, width: 0.3, height: 1 },
  ])('rejects invalid crop coordinates', async (crop) => {
    await expect(validateAndNormalizeServerImage(await png(), crop))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', statusCode: 400 });
  });
});

function streamResponse(status: number, headers: Record<string, string> = {}, chunks: Buffer[] = []) {
  return {
    status,
    headers: new Headers(headers),
    body: (async function* () { yield* chunks; })(),
    cancel: vi.fn(),
  };
}

function stubTransport() {
  const publicAddress = { address: '93.184.216.34', family: 4 };
  return {
    resolve: vi.fn<SafeImageTransport['resolve']>().mockResolvedValue([publicAddress]),
    request: vi.fn<SafeImageTransport['request']>(),
  };
}

describe('public HTTPS transport', () => {
  it('connects to the validated address with the original host and query', async () => {
    const bytes = await png();
    const transport = stubTransport();
    const secondAddress = { address: '8.8.8.8', family: 4 };
    transport.resolve.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([secondAddress]);
    transport.request.mockResolvedValueOnce(streamResponse(302, { location: 'https://cdn.example.com/look.png?w=1080' }))
      .mockResolvedValueOnce(streamResponse(200, {}, [bytes]));
    await expect(fetchDirectImageUrlSafe('https://example.com/img', transport)).resolves.toEqual(bytes);
    expect(transport.resolve.mock.calls).toEqual([['example.com'], ['cdn.example.com']]);
    const [url, address] = transport.request.mock.calls[1];
    expect(url.href).toBe('https://cdn.example.com/look.png?w=1080');
    expect(address).toEqual(secondAddress);
  });

  it.each(['http://example.com/image', 'https://127.0.0.1/image', 'https://10.0.0.1/image',
    'https://169.254.169.254/image', 'https://[::1]/image', 'https://[::ffff:127.0.0.1]/image'])(
    'rejects unsafe URLs before connecting',
    async (url) => {
      const transport = stubTransport();
      await expect(fetchDirectImageUrlSafe(url, transport)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
      expect(transport.request).not.toHaveBeenCalled();
    },
  );

  it('passes the pinned IP, original SNI and original certificate identity to HTTPS', async () => {
    const bytes = await png();
    const resolveAll: (hostname: string, options: { all: true }) => Promise<LookupAddress[]> = lookup;
    vi.mocked(resolveAll).mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    vi.mocked(httpsRequest).mockImplementationOnce(((_options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const response = Object.assign(Readable.from([bytes]), { headers: {}, statusCode: 200 });
      return Object.assign(new EventEmitter(), { end: () => callback(response as unknown as IncomingMessage) });
    }) as typeof httpsRequest);
    await expect(fetchDirectImageUrlSafe('https://cdn.example.com/look.png')).resolves.toEqual(bytes);
    expect(httpsRequest).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(httpsRequest).mock.calls[0] as unknown as [RequestOptions];
    const certificate = { subjectaltname: 'DNS:cdn.example.com', subject: {} } as DetailedPeerCertificate;
    expect(options).toMatchObject({
      hostname: '93.184.216.34', servername: 'cdn.example.com',
      headers: { host: 'cdn.example.com' }, rejectUnauthorized: true,
    });
    expect(options.checkServerIdentity!('93.184.216.34', certificate)).toBeUndefined();
    expect(options.checkServerIdentity!('cdn.example.com', {
      ...certificate, subjectaltname: 'IP Address:93.184.216.34',
    })).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });

  it('rejects a redirect when any DNS answer is non-public', async () => {
    const transport = stubTransport();
    const redirect = streamResponse(302, { location: 'https://internal.example/meta' });
    transport.request.mockResolvedValueOnce(redirect);
    transport.resolve.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }, { address: '169.254.169.254', family: 4 }]);
    await expect(fetchDirectImageUrlSafe('https://public.example/img', transport)).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(redirect.cancel).toHaveBeenCalled();
  });

  it('follows at most one redirect', async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValueOnce(streamResponse(302, { location: '/second' }))
      .mockResolvedValueOnce(streamResponse(307, { location: '/third' }));
    await expect(fetchDirectImageUrlSafe('https://public.example/img', transport)).rejects.toMatchObject({
      code: 'SSRF_BLOCKED',
    });
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('gives screenshot guidance for HTML responses', async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(streamResponse(200, { 'content-type': 'text/html; charset=utf-8' }));
    await expect(fetchDirectImageUrlSafe('https://public.example/page', transport)).rejects.toMatchObject({
      code: 'HTML_PAGE_URL_UNSUPPORTED', statusCode: 422, message: expect.stringMatching(/screenshot/i),
    });
  });

  it('rejects bodies without image magic', async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(streamResponse(200, { 'content-type': 'image/png' }, [Buffer.from('bad')]));
    await expect(fetchDirectImageUrlSafe('https://public.example/bad.png', transport)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE_FORMAT',
    });
  });

  it('bounds streaming bytes even with no content-length', async () => {
    const transport = stubTransport();
    const response = streamResponse(200, {}, [Buffer.alloc(4), Buffer.alloc(4)]);
    transport.request.mockResolvedValue(response);
    await expect(fetchPublicHttps('https://public.example/img', { transport, maxBytes: 7 })).rejects.toMatchObject({
      code: 'IMAGE_TOO_LARGE',
    });
    expect(response.cancel).toHaveBeenCalled();
  });

  it('enforces the deadline during DNS resolution', async () => {
    const transport = stubTransport();
    transport.resolve.mockImplementation(() => new Promise(() => {}));
    await expect(fetchPublicHttps('https://public.example/img', { transport, timeoutMs: 15 }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/timed out/i) });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('cancels a stalled response body at the deadline', async () => {
    const transport = stubTransport();
    const response = streamResponse(200);
    response.body = (async function* () { yield await new Promise<Buffer>(() => {}); })();
    transport.request.mockResolvedValue(response);
    await expect(fetchPublicHttps('https://public.example/img', { transport, timeoutMs: 15 }))
      .rejects.toMatchObject({ code: 'INVALID_INPUT', message: expect.stringMatching(/timed out/i) });
    expect(response.cancel).toHaveBeenCalled();
  });

  it('validates an allowlist on every redirect before resolving it', async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValueOnce(streamResponse(302, { location: 'https://other.example/api' }));
    await expect(fetchPublicHttps('https://public.example/api', {
      transport,
      validateUrl: (url) => { if (url.hostname !== 'public.example') throw new Error('Origin disallowed'); },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(transport.resolve.mock.calls).toEqual([['public.example']]);
  });

  it('disposes a stalled response once when the deadline expires', async () => {
    const transport = stubTransport();
    const response = streamResponse(200);
    let release!: (chunk: Buffer) => void;
    response.body = (async function* () { yield await new Promise<Buffer>((resolve) => { release = resolve; }); })();
    response.cancel.mockImplementation(() => release(Buffer.from('late')));
    transport.request.mockResolvedValue(response);
    await expect(fetchPublicHttps('https://public.example/img', { transport, timeoutMs: 15 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.cancel).toHaveBeenCalledTimes(1);
  });

  it('allows bounded JSON fetches', async () => {
    const transport = stubTransport();
    transport.request.mockResolvedValue(
      streamResponse(200, { 'content-type': 'application/json' }, [Buffer.from('{"ok":true}')]),
    );
    const response = await fetchPublicHttps('https://public.example/api', { transport });
    expect(response.bytes.toString()).toBe('{"ok":true}');
  });
});

it('only reads bundled demo images without invoking HTTPS transport', async () => {
  vi.stubEnv('SEAMLENS_LOCAL_DEMO', '1');
  vi.stubEnv('DATABASE_URL', 'postgres://demo:fixture@127.0.0.1:5432/seamlens_demo');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3101');
  vi.stubEnv('VERCEL', undefined);
  const transport = stubTransport();
  try {
    const bytes = await fetchDirectImageUrlSafe('https://demo.seamlens.test/samples/01-floral-cowl.webp', transport);
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    for (const url of [
      'https://somewhere.example/photo.webp',
      'https://demo.seamlens.test/samples/01-floral-cowl.webp?external=1',
      'file:///eval/fixtures/smoke-v1/images/01-floral-cowl.webp',
      'https://127.0.0.1/samples/01-floral-cowl.webp',
    ]) {
      await expect(fetchDirectImageUrlSafe(url, transport)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(transport.resolve).not.toHaveBeenCalled();
    expect(transport.request).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
