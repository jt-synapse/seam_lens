import { z } from 'zod';
import {
  DeliveryFormatSchema, SkillLevelSchema, SubstrateCompatibilitySchema,
  type DeliveryFormat, type SkillLevel, type SubstrateCompatibility,
} from '@/modules/taxonomy/construction-profile';
import { parseMeasurementInches } from '@/modules/taxonomy/measurements';

export interface RawSizeBandCandidate {
  externalProductId: string | null;
  bandLabel: string;
  isDefault: boolean;
  productUrl: string;
  priceCents: number | null;
  currency: string;
  designerSizeLabel: string | null;
  bustMinIn: number | null;
  bustMaxIn: number | null;
  hipMinIn: number | null;
  hipMaxIn: number | null;
}

export interface NormalizedImportDraft {
  groupKey: string;
  title: string;
  garmentCategoryHint?: 'dress' | 'top' | 'dress_and_top_set';
  substrateHint?: SubstrateCompatibility;
  formatsHint: DeliveryFormat[];
  skillHint?: SkillLevel;
  descriptionHtml: string;
  imageUrls: Array<{ url: string; roleHint?: 'cover' | 'flat_front' | 'flat_back'; viewCode?: string }>;
  sizeBands: RawSizeBandCandidate[];
  explicitViews?: Array<{ viewCode: string; viewLabel: string }>;
}

function httpUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('A public product or image URL is required');
  }
  return url.href;
}

function priceCents(price?: string) {
  if (!price) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw new Error('Invalid product price');
  const cents = Math.round(Number(price) * 100);
  if (!Number.isSafeInteger(cents) || cents > 2147483647) throw new Error('Product price exceeds range');
  return cents;
}

function currency(code?: string) {
  const value = (code || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new Error('Expected a three-letter currency');
  return value;
}

function group(drafts: Map<string, NormalizedImportDraft>, title: string) {
  const groupKey = title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!groupKey) throw new Error('Missing product title');
  let draft = drafts.get(groupKey);
  if (!draft) {
    draft = { groupKey, title: title.trim(), descriptionHtml: '', formatsHint: [], imageUrls: [], sizeBands: [] };
    drafts.set(groupKey, draft);
  }
  return draft;
}

function addImage(draft: NormalizedImportDraft, image: NormalizedImportDraft['imageUrls'][number]) {
  if (!draft.imageUrls.some(i => i.url === image.url && i.viewCode === image.viewCode && i.roleHint === image.roleHint)) {
    draft.imageUrls.push(image);
  }
}

const shopifyFeed = z.object({
  currency: z.string().optional(),
  products: z.array(z.object({
    id: z.union([z.string().min(1), z.number().int().safe()]),
    title: z.string().trim().min(1),
    handle: z.string().regex(/^[\w-]+$/),
    body_html: z.string().nullish(),
    currency: z.string().optional(),
    variants: z.array(z.object({ price: z.string().optional() })).optional(),
    images: z.array(z.object({ src: z.string() })).optional(),
  })),
});

// Match only a complete trailing edition or range. Keep names such as "Learning Curve Top".
const editionSuffix = /(?:\s*[-–—(]\s*|\s+)((?:(?:curve|plus|extended|straight)(?:\s+(?:sizing|edition))?(?:\s*[-–—:(]?\s*(?:sizes?\s*)?\d+\s*[-–—]\s*\d+\)?)?|sizes?\s+\d+\s*[-–—]\s*\d+))\s*\)*$/i;

export function parseShopifyProductsJson(json: unknown, storefrontBaseUrl: string): NormalizedImportDraft[] {
  const feed = shopifyFeed.parse(json);
  const storefront = new URL(httpUrl(storefrontBaseUrl));
  const drafts = new Map<string, NormalizedImportDraft>();
  for (const product of feed.products) {
    const suffix = editionSuffix.exec(product.title);
    const title = suffix ? product.title.slice(0, suffix.index).trim() : product.title;
    const draft = group(drafts, title || product.title);
    draft.descriptionHtml ||= product.body_html ?? '';
    for (const image of product.images ?? []) addImage(draft, { url: httpUrl(new URL(image.src, storefront).href) });
    const externalProductId = String(product.id);
    if (draft.sizeBands.some(band => band.externalProductId === externalProductId)) continue;
    const bandLabel = suffix?.[1] ?? 'Standard';
    if (draft.sizeBands.some(band => band.bandLabel === bandLabel)) throw new Error('Ambiguous Shopify band label');
    draft.sizeBands.push({
      externalProductId, bandLabel, isDefault: !draft.sizeBands.length,
      productUrl: new URL('/products/' + product.handle, storefront).href,
      priceCents: priceCents(product.variants?.[0]?.price), currency: currency(product.currency ?? feed.currency),
      designerSizeLabel: suffix?.[1] ?? null, bustMinIn: null, bustMaxIn: null, hipMinIn: null, hipMaxIn: null,
    });
  }
  return Array.from(drafts.values());
}

// Preserve quoted newlines and doubled quotes, including across CRLF files.
function csvRows(text: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  function endField() { row.push(field); field = ''; closed = false; }
  function endRow() {
    endField();
    if (row.some(value => value.trim())) rows.push(row);
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === ',') endField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error('Unexpected character in CSV field');
    else field += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  endRow();
  return rows;
}

const category = z.enum(['dress', 'top', 'dress_and_top_set']);

export function parseSeamLensCsv(csvText: string): NormalizedImportDraft[] {
  const [first, ...rows] = csvRows(csvText);
  const headers = first?.map(name => name.trim().toLowerCase()) ?? [];
  if (!headers.includes('title') || !headers.includes('product_url') || new Set(headers).size !== headers.length) {
    throw new Error('CSV requires distinct headers including title and product_url');
  }
  const drafts = new Map<string, NormalizedImportDraft>();
  for (const fields of rows) {
    if (fields.length !== headers.length) throw new Error('CSV row and header widths differ');
    const row = Object.fromEntries(headers.map((name, index) => [name, fields[index].trim()]));
    const draft = group(drafts, row.title);
    draft.descriptionHtml ||= row.description_html ?? '';
    if (row.garment_category) draft.garmentCategoryHint = category.parse(row.garment_category);
    if (row.substrate_type) draft.substrateHint = SubstrateCompatibilitySchema.parse(row.substrate_type);
    if (row.skill_level) draft.skillHint = SkillLevelSchema.parse(row.skill_level);
    for (const format of (row.formats || '').split(/[|;,]/).map(s => s.trim()).filter(Boolean)) {
      const value = DeliveryFormatSchema.parse(format);
      if (!draft.formatsHint.includes(value)) draft.formatsHint.push(value);
    }
    const viewCode = row.view_code || undefined;
    if (viewCode) {
      draft.explicitViews ??= [];
      if (!draft.explicitViews.some(view => view.viewCode === viewCode)) {
        draft.explicitViews.push({ viewCode, viewLabel: row.view_label || viewCode });
      }
    }
    for (const roleHint of ['cover', 'flat_front', 'flat_back'] as const) {
      const url = row[roleHint + '_image_url'];
      if (url) addImage(draft, { url: httpUrl(url), roleHint, viewCode });
    }
    const measure = (key: string) => row[key + '_cm']
      ? parseMeasurementInches(row[key + '_cm'], 'cm')
      : parseMeasurementInches(row[key + '_in'] || row[key]);
    const bandLabel = row.band_label || 'Standard';
    const band = {
      externalProductId: row.external_id || null, bandLabel, isDefault: !draft.sizeBands.length,
      productUrl: httpUrl(row.product_url), priceCents: priceCents(row.price), currency: currency(row.currency),
      designerSizeLabel: row.designer_size_label || null,
      bustMinIn: measure('bust_min'), bustMaxIn: measure('bust_max'), hipMinIn: measure('hip_min'), hipMaxIn: measure('hip_max'),
    };
    const existing = draft.sizeBands.find(b => b.bandLabel === bandLabel || (band.externalProductId && b.externalProductId === band.externalProductId));
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify({ ...band, isDefault: existing.isDefault })) {
        throw new Error('Conflicting CSV rows for size band ' + bandLabel);
      }
    } else draft.sizeBands.push(band);
  }
  return Array.from(drafts.values());
}
