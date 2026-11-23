import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import cowlProfile from '../../eval/fixtures/smoke-v1/profiles/01-floral-cowl.json';
import bishopProfile from '../../eval/fixtures/smoke-v1/profiles/05-raglan-bishop.json';

export const DEMO_REFERENCE_URL = 'https://demo.seamlens.test/samples/01-floral-cowl.webp';
export const DEMO_SHOPIFY_STOREFRONT = 'https://maisonverveine.example';
export const DEMO_SHOPIFY_PRODUCT_HANDLE = 'demo-tansy-bishop-blouse';
export const DEMO_SHOPIFY_IMAGE_URL = 'https://demo.seamlens.test/samples/05-raglan-bishop.webp';

export const demoCowlFixture = {
  profile: cowlProfile,
  readImage: () => readFile(join(process.cwd(), 'eval/fixtures/smoke-v1/images/01-floral-cowl.webp')),
};
export const demoBishopFixture = {
  profile: bishopProfile,
  readImage: () => readFile(join(process.cwd(), 'eval/fixtures/smoke-v1/images/05-raglan-bishop.webp')),
};

export function getDemoImage(url: string) {
  if (url === DEMO_REFERENCE_URL) return demoCowlFixture.readImage();
  if (url === DEMO_SHOPIFY_IMAGE_URL) return demoBishopFixture.readImage();
  return undefined;
}
