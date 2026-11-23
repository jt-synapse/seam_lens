import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity } from 'node:tls';
import sharp from 'sharp';

import { SearchError } from './search-error';

export { SearchError } from './search-error';

export type CropBox = { x: number; y: number; width: number; height: number };

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 40_000_000;
const MAX_OUTPUT_DIMENSION = 1280;

function unsupportedImage() {
  return new SearchError('UNSUPPORTED_IMAGE_FORMAT', 415, 'Use a JPEG, PNG, WebP or AVIF image.');
}

function imageFormat(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (bytes.toString('latin1', 4, 12) === 'ftypavif') return 'heif';
  throw unsupportedImage();
}

function validateCrop(crop: CropBox) {
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every(Number.isFinite)
    || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new SearchError('INVALID_INPUT', 400, 'The crop must be inside the image and have a positive size.');
  }
}

export async function validateAndNormalizeServerImage(raw: Buffer, cropBox?: CropBox | null) {
  if (raw.length > MAX_IMAGE_BYTES) {
    throw new SearchError('IMAGE_TOO_LARGE', 413, 'Choose an image up to 8 MiB.');
  }
  const format = imageFormat(raw);
  if (cropBox != null) validateCrop(cropBox);

  try {
    const image = sharp(raw, { limitInputPixels: MAX_SOURCE_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    const { width, height, orientation } = metadata;
    if (metadata.format !== format || (format === 'heif' && metadata.compression !== 'av1') || !width || !height) {
      throw unsupportedImage();
    }
    if (width * height > MAX_SOURCE_PIXELS) {
      throw new SearchError('IMAGE_TOO_LARGE', 413, 'Choose an image up to 40 megapixels.');
    }

    // Rotate first so extraction uses the same axes as the browser's upright preview.
    image.rotate();
    if (cropBox) {
      const swapped = orientation !== undefined && orientation >= 5 && orientation <= 8;
      const uprightWidth = swapped ? height : width;
      const uprightHeight = swapped ? width : height;
      const left = Math.floor(cropBox.x * uprightWidth);
      const top = Math.floor(cropBox.y * uprightHeight);
      const right = Math.ceil((cropBox.x + cropBox.width) * uprightWidth);
      const bottom = Math.ceil((cropBox.y + cropBox.height) * uprightHeight);
      image.extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) });
    }

    const { data: webpBytes, info } = await image
      .resize({
        width: MAX_OUTPUT_DIMENSION,
        height: MAX_OUTPUT_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      webpBytes,
      sha256: createHash('sha256').update(webpBytes).digest('hex'),
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof SearchError) throw error;
    if (error instanceof Error && error.message.includes('pixel limit')) {
      throw new SearchError('IMAGE_TOO_LARGE', 413, 'Choose an image up to 40 megapixels.');
    }
    throw unsupportedImage();
  }
}

type ResolvedAddress = { address: string; family: number };
type HttpsResponse = {
  status: number;
  headers: Headers;
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
};

export type SafeImageTransport = {
  resolve(hostname: string): Promise<readonly ResolvedAddress[]>;
  request(url: URL, address: ResolvedAddress, signal: AbortSignal): Promise<HttpsResponse>;
};

// IANA special-purpose allocations plus reserved and multicast space.
const specialAddresses = new BlockList();
const specialV4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 3],
];
const specialV6: Array<[string, number]> = [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['2620:4f:8000::', 48],
  ['3fff::', 20],
];
for (const [address, prefix] of specialV4) specialAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of specialV6) specialAddresses.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function isPublicAddress({ address, family }: ResolvedAddress) {
  if (isIP(address) !== family || address.includes('%')) return false;
  if (family === 4) return !specialAddresses.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !specialAddresses.check(address, 'ipv6');
}

function urlHostname(url: URL) {
  const { hostname } = url;
  return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
}

const defaultTransport: SafeImageTransport = {
  resolve: (hostname) => lookup(hostname, { all: true }),
  request: (url, address, signal) => new Promise((resolve, reject) => {
    const hostname = urlHostname(url);
    // Connect to the vetted IP directly. SNI, certificate identity, and HTTP Host use the original hostname.
    const outgoing = request({
      hostname: address.address,
      family: address.family,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: { host: url.host, 'accept-encoding': 'identity' },
      method: 'GET',
      agent: false,
      servername: isIP(hostname) ? '' : hostname,
      rejectUnauthorized: true,
      checkServerIdentity: (_host, certificate) => checkServerIdentity(hostname, certificate),
      signal,
    }, (response) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (typeof value === 'string') headers.set(name, value);
        else if (value) for (const item of value) headers.append(name, item);
      }
      resolve({
        status: response.statusCode ?? 0,
        headers,
        body: response,
        cancel: () => response.destroy(),
      });
    });
    outgoing.on('error', reject);
    outgoing.end();
  }),
};

type PublicFetchOptions = {
  transport?: SafeImageTransport;
  timeoutMs?: number;
  maxBytes?: number;
  validateUrl?: (url: URL) => void;
  validateHeaders?: (headers: Headers) => void;
};

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function parseHttpsUrl(rawUrl: string, base?: URL) {
  let url: URL;
  try {
    url = new URL(rawUrl, base);
  } catch {
    throw new SearchError('INVALID_INPUT', 400, 'Enter a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new SearchError('SSRF_BLOCKED', 422, 'Use a public HTTPS URL without credentials.');
  }
  return url;
}

async function readResponse(response: HttpsResponse, maxBytes: number, signal: AbortSignal) {
  const length = Number(response.headers.get('content-length'));
  if (length > maxBytes) {
    throw new SearchError('IMAGE_TOO_LARGE', 413, 'The response exceeds the download size limit.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    signal.throwIfAborted();
    size += chunk.byteLength;
    if (size > maxBytes) {
      throw new SearchError('IMAGE_TOO_LARGE', 413, 'The response exceeds the download size limit.');
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

export async function fetchPublicHttps(rawUrl: string, options: PublicFetchOptions = {}) {
  const { transport = defaultTransport, maxBytes = MAX_IMAGE_BYTES, timeoutMs = 3000 } = options;
  const controller = new AbortController();
  const { signal } = controller;
  const timeoutError = new SearchError('INVALID_INPUT', 422, 'The HTTPS download timed out.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelActiveResponse: (() => void) | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
      controller.abort(timeoutError);
      cancelActiveResponse?.();
    }, timeoutMs);
  });

  async function download() {
    let url = parseHttpsUrl(rawUrl);
    for (let hop = 0; ; hop++) {
      options.validateUrl?.(url);
      const hostname = urlHostname(url);
      const family = isIP(hostname);
      const addresses = family ? [{ address: hostname, family }] : await transport.resolve(hostname);
      signal.throwIfAborted();
      const [address] = addresses;
      if (!address || addresses.some((answer) => !isPublicAddress(answer))) {
        throw new SearchError('SSRF_BLOCKED', 422, 'Use a URL that resolves exclusively to public addresses.');
      }
      const response = await transport.request(url, address, signal);
      let cancelled = false;
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        response.cancel();
      };
      cancelActiveResponse = cancel;
      try {
        signal.throwIfAborted();
        if (redirectStatuses.has(response.status)) {
          const location = response.headers.get('location');
          if (hop === 1 || !location) throw new SearchError('SSRF_BLOCKED', 422, 'Too many or invalid HTTPS redirects.');
          url = parseHttpsUrl(location, url);
          continue;
        }
        options.validateHeaders?.(response.headers);
        if (response.status < 200 || response.status >= 300) {
          throw new SearchError('INVALID_INPUT', 422, 'The URL did not return a successful response.');
        }
        const bytes = await readResponse(response, maxBytes, signal);
        return { bytes, headers: response.headers };
      } finally {
        cancel();
        cancelActiveResponse = undefined;
      }
    }
  }

  try {
    return await Promise.race([deadline, download()]);
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError('INVALID_INPUT', 422, 'Could not download from the HTTPS URL.');
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDirectImageUrlSafe(rawUrl: string, deps?: SafeImageTransport) {
  const { bytes } = await fetchPublicHttps(rawUrl, {
    transport: deps,
    validateHeaders: (headers) => {
      const mediaType = headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
        throw new SearchError('HTML_PAGE_URL_UNSUPPORTED', 422, 'This URL leads to a web page. Upload a screenshot or paste a direct image URL.');
      }
    },
  });
  imageFormat(bytes);
  return bytes;
}
