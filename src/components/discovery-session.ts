'use client';

import { buildPreparedUploadForm } from '@/modules/search/client-canvas-preprocess';
import type { SearchExecutionResult, SearchFilters } from '@/modules/search/hybrid-ranker';
import type { CropBox } from '@/modules/search/image-ingest';
import { z } from 'zod';
import { ConstructionProfileV1Schema, DeliveryFormatSchema, FocusRegionSchema, GarmentCategorySchema,
  SkillLevelSchema, SubstrateCompatibilitySchema, FOCUS_REGIONS, type FocusRegion } from '@/modules/taxonomy/construction-profile';

export type DiscoverySource =
  | { kind: 'upload'; previewDataUrl: string; cropApplied: boolean }
  | { kind: 'url'; imageUrl: string; cropBox?: CropBox | null }
  | { kind: 'archetype'; slug: string; imageUrl: string; title: string };

export type DiscoverySession = {
  recoveryAttempted?: boolean;
  result: SearchExecutionResult;
  source: DiscoverySource | null;
  focusRegion: FocusRegion;
  filters: SearchFilters;
};

const webImage = z.string().refine(url => {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try { return ['https:', 'http:'].includes(new URL(url).protocol); } catch { return false; }
});
export function validImageUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
const directImage = z.string().refine(validImageUrl);
const crop = z.object({x:z.number().min(0), y:z.number().min(0), width:z.number().positive(), height:z.number().positive()})
  .refine(box => box.x + box.width <= 1 && box.y + box.height <= 1);
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({kind:z.literal('upload'),previewDataUrl:z.string().startsWith('data:image/webp;base64,'),cropApplied:z.boolean()}),
  z.object({kind:z.literal('url'),imageUrl:directImage,cropBox:crop.nullish()}),
  z.object({kind:z.literal('archetype'),slug:z.string(),imageUrl:webImage,title:z.string()}),
]);
const filtersSchema = z.object({
  substrate:z.enum(['woven','knit']).nullish(), userBustIn:z.number().positive().nullish(), userHipIn:z.number().positive().nullish(),
  formats:z.array(DeliveryFormatSchema).optional(), skills:z.array(SkillLevelSchema).optional(),
});
const chip = z.object({kind:z.enum(['matched','diff']),slot:z.string(),label:z.string()});
const resultSchema = z.object({
  querySessionId:z.string().min(1), queryStatus:z.enum(['ok','low_visibility_partial','unsupported_category_v1']),
  extractedProfile:ConstructionProfileV1Schema, warnings:z.array(z.string()),
  relaxationHints:z.array(z.object({facet:filtersSchema.keyof(),resultCount:z.number(),label:z.string()})),
  results:z.array(z.object({
    patternId:z.string(),viewId:z.string(),viewLabel:z.string(),secondaryViewCount:z.number(),garmentCategory:GarmentCategorySchema,
    title:z.string(),makerName:z.string(),coverImageUrl:webImage,flatFrontImageUrl:webImage.nullable(),flatBackImageUrl:webImage.nullable(),
    matchedSizeBandId:z.string(),priceCents:z.number().nullable(),currency:z.string().regex(/^[A-Za-z]{3}$/),
    bustRangeIn:z.tuple([z.number(),z.number()]),hipRangeIn:z.tuple([z.number().nullable(),z.number().nullable()]),
    designerSizeLabel:z.string(),substrateType:SubstrateCompatibilitySchema,formats:z.array(DeliveryFormatSchema),
    skillLevel:SkillLevelSchema,totalScore:z.number(),matchedChips:z.array(chip),diffChips:z.array(chip),
  })),
});
const snapshotSchema = z.object({recoveryAttempted:z.boolean().optional(),result:resultSchema,source:sourceSchema.nullable(),focusRegion:FocusRegionSchema,filters:filtersSchema});

const prefix = 'seamlens:discovery:v1:';
const retainedLimit = 4;
const memory = new Map<string, DiscoverySession>();
const handoffs = new Set<string>();

export function consumeDiscoveryHandoff(id: string) {
  return handoffs.delete(id);
}

// The preview and recovery source live in the current browser tab only.
export function saveDiscoverySession(session: DiscoverySession, handoff = true) {
  const id = session.result.querySessionId;
  memory.delete(id);
  memory.set(id, session);
  if (handoff) handoffs.add(id);
  else handoffs.delete(id);
  if (memory.size > retainedLimit) {
    const oldest = memory.keys().next().value!;
    memory.delete(oldest);
    handoffs.delete(oldest);
  }
  try {
    const key = prefix + id;
    const store = window.sessionStorage;
    const old = Object.keys(store).filter(k => k.startsWith(prefix) && k !== key);
    while (old.length >= retainedLimit) store.removeItem(old.shift()!);
    const text = JSON.stringify(session);
    for (;;) {
      try { store.setItem(key, text); break; }
      catch { if (!old.length) { store.removeItem(key); break; } store.removeItem(old.shift()!); }
    }
  } catch { /* In-memory navigation also works with browser storage disabled. */ }
}

export function readDiscoverySession(id: string): DiscoverySession | null {
  const current = memory.get(id);
  if (current) return current;
  try {
    const saved = snapshotSchema.safeParse(JSON.parse(window.sessionStorage.getItem(prefix + id) ?? 'null'));
    if (saved.success && saved.data.result.querySessionId === id) return saved.data;
  } catch { /* Ignore an incomplete or unavailable tab cache. */ }
  return null;
}

export class DiscoveryRequestError extends Error {
  constructor(readonly code: string, message: string, readonly availableFocusRegions?: FocusRegion[]) {
    super(message);
    this.name = 'DiscoveryRequestError';
  }
}

async function post(path: string, body: FormData | object, signal?: AbortSignal): Promise<SearchExecutionResult> {
  const multipart = body instanceof FormData;
  const response = await fetch(path, {
    method: 'POST', body: multipart ? body : JSON.stringify(body),
    headers: multipart ? undefined : { 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DiscoveryRequestError(typeof data?.code === 'string' ? data.code : 'SEARCH_FAILED',
      typeof data?.message === 'string' ? data.message : 'Search is unavailable. Please try again.',
      Array.isArray(data?.availableFocusRegions) ? data.availableFocusRegions.filter((r: FocusRegion) => FOCUS_REGIONS.includes(r)) : undefined);
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new DiscoveryRequestError('SEARCH_FAILED', 'Could not read the search results. Please try again.');
  return parsed.data;
}

export function queryDiscoverySession(querySessionId: string, focusRegion: FocusRegion, filters: SearchFilters, signal?: AbortSignal) {
  return post('/api/v1/search/query', {querySessionId, focusRegion, filters}, signal);
}

export async function analyzeDiscoverySource(
  source: DiscoverySource, focusRegion: FocusRegion, filters: SearchFilters, signal?: AbortSignal, preparedBlob?: Blob,
) {
  const path = '/api/v1/search/analyze';
  if (source.kind === 'archetype') return post(path, {archetypeSlug: source.slug, focusRegion, filters}, signal);
  if (source.kind === 'url') return post(path, {imageUrl: source.imageUrl, cropBox: source.cropBox, focusRegion, filters}, signal);
  let blob = preparedBlob;
  if (!blob) {
    const marker = 'data:image/webp;base64,';
    if (!source.previewDataUrl.startsWith(marker)) throw new Error('Choose the original photo again.');
    const binary = atob(source.previewDataUrl.slice(marker.length));
    blob = new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], {type:'image/webp'});
  }
  const form = buildPreparedUploadForm(blob, focusRegion, filters);
  if (source.cropApplied) form.set('cropApplied','true');
  return post(path, form, signal);
}
