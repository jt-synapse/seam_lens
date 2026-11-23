import type { SupabaseClient } from '@supabase/supabase-js';
import { getDbPool, type Queryable } from '@/lib/db';
import { getCatalogMediaBucket } from '@/lib/env';
import { isLocalDemo } from '@/lib/local-demo';
import {
  DEMO_SHOPIFY_IMAGE_URL, DEMO_SHOPIFY_PRODUCT_HANDLE, DEMO_SHOPIFY_STOREFRONT,
} from '@/lib/local-demo-fixtures';
import { createSupabaseServiceClient } from '@/lib/supabase/server';
import { fetchDirectImageUrlSafe, fetchPublicHttps, type SafeImageTransport } from '@/modules/search/image-ingest';
import { createDemoGalleryClassifier } from '@/modules/vision/local-demo-models';
import { createTextEmbedder, createVisionExtractor } from '@/modules/vision/production';
import type { IngestionWorkerDeps } from './chunk-worker';
import { createGalleryClassifier } from './gallery-classifier';
import { createGalleryPreparer } from './media-pipeline';
import { parseShopifyProductsJson } from './parsers';

export function createCatalogMediaWriter(client: SupabaseClient, bucket: string) {
  const store = client.storage.from(bucket);
  return async (key: string, bytes: Buffer) => {
    const { error } = await store.upload(key, bytes, { contentType: 'image/webp', upsert: false });
    if (error) {
      const code = 'code' in error ? error.code : undefined;
      const exists = code === 'ResourceAlreadyExists' || code === 'KeyAlreadyExists' || code === 'Duplicate' ||
        (!code && /already exists|^duplicate$/i.test(error.message));
      if (!exists) throw error;
    }
    return bucket + '/' + key;
  };
}

export function createIngestionWorkerDeps(db: Queryable = getDbPool()): IngestionWorkerDeps {
  return {
    db,
    vision: createVisionExtractor(db),
    embedder: createTextEmbedder(db),
    prepareGallery: createGalleryPreparer({
      fetchImage: fetchDirectImageUrlSafe,
      write: createCatalogMediaWriter(createSupabaseServiceClient(), getCatalogMediaBucket()),
      classify: isLocalDemo() ? createDemoGalleryClassifier(db) : createGalleryClassifier(db),
    }),
  };
}

export async function fetchApprovedShopifyDrafts(
  db: Queryable, makerId: string, source?: string, transport?: SafeImageTransport,
) {
  async function approvedStorefront() {
    const { rows: [maker] } = await db.query<{ storefront_url: string }>(
      "SELECT storefront_url FROM makers WHERE id=$1 AND vetted_status='approved'", [makerId],
    );
    if (!maker) throw new Error('Choose an approved maker before fetching a Shopify feed');
    return new URL(maker.storefront_url);
  }

  const storefront = await approvedStorefront();
  const url = new URL(source || '/products.json', storefront);
  url.pathname = url.pathname.replace(/\/$/, '');
  if (url.pathname === '/' || /^\/collections\/[\w-]+$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/$/, '') + '/products.json';
  }
  if (/^\/products\/[\w-]+$/.test(url.pathname)) url.pathname += '.json';
  const single = /^\/products\/[\w-]+\.json$/.test(url.pathname);
  if (!single && !/^\/(?:collections\/[\w-]+\/)?products\.json$/.test(url.pathname)) {
    throw new Error('Choose a Shopify storefront, collection or product feed');
  }
  const pageSize = 250;
  if (!single) url.searchParams.set('limit', String(pageSize));
  if (isLocalDemo()) {
    if (storefront.origin !== DEMO_SHOPIFY_STOREFRONT || url.origin !== storefront.origin ||
        url.username || url.password || url.hash || [...url.searchParams.keys()].some(key => key !== 'limit') ||
        !['/products.json', '/collections/demo/products.json', '/products/' + DEMO_SHOPIFY_PRODUCT_HANDLE + '.json'].includes(url.pathname)) {
      throw new Error('The local demo Shopify feed is available for Maison Verveine at /products.json, /collections/demo and /products/' + DEMO_SHOPIFY_PRODUCT_HANDLE);
    }
    return parseShopifyProductsJson({
      currency: 'USD',
      products: [{
        id: 'demo-tansy-bishop-blouse',
        title: 'Demo Tansy Bishop Blouse',
        handle: DEMO_SHOPIFY_PRODUCT_HANDLE,
        body_html: '<p>A woven blouse with gathered bishop sleeves and a keyhole neckline.</p>',
        variants: [{ price: '14.00' }],
        images: [{ src: DEMO_SHOPIFY_IMAGE_URL }],
      }],
    }, storefront.href);
  }
  let next = url;
  let totalBytes = 0;
  let feedCurrency: unknown;
  const products: unknown[] = [];
  const seenPages = new Set<string>();
  const validateUrl = (candidate: URL) => {
    if (candidate.origin !== storefront.origin || candidate.pathname !== url.pathname) {
      throw new Error('Shopify feed must stay on the approved storefront and path');
    }
  };
  for (let page = 1; page <= 16; page++) {
    if (seenPages.has(next.href)) throw new Error('Shopify repeated a feed page');
    seenPages.add(next.href);
    if (page > 1 && (await approvedStorefront()).origin !== storefront.origin) {
      throw new Error('Approved storefront changed during import');
    }
    const { bytes, headers } = await fetchPublicHttps(next.href, {
      transport, validateUrl, maxBytes: Math.min(8 * 1024 * 1024, 32 * 1024 * 1024 - totalBytes),
    });
    totalBytes += bytes.length;
    const payload = JSON.parse(bytes.toString('utf8'));
    if (single) return parseShopifyProductsJson({ products: [payload.product], currency: payload.currency }, storefront.href);
    if (!Array.isArray(payload.products) || payload.products.length > pageSize) throw new Error('Invalid Shopify feed page');
    products.push(...payload.products);
    feedCurrency ??= payload.currency;
    const link = headers.get('link')?.match(/<([^>]+)>\s*;\s*rel="?next"?/i)?.[1];
    if (!link && payload.products.length < pageSize) {
      return parseShopifyProductsJson({ products, currency: feedCurrency }, storefront.href);
    }
    if (link) next = new URL(link, next);
    else {
      next = new URL(next);
      const previous = Number(next.searchParams.get('page') || '1');
      next.searchParams.set('page', String(previous + 1));
    }
  }
  throw new Error('Shopify feed exceeds the batch limit. Import a smaller collection.');
}
