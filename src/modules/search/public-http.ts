import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { withTransaction, type Queryable } from '@/lib/db';
import { getRateLimitIpSalt } from '@/lib/env';
import { ArchetypeUnavailableError } from '@/modules/catalog/archetypes-repo';
import { DeliveryFormatSchema, FocusRegionSchema, SkillLevelSchema } from '@/modules/taxonomy/construction-profile';
import { BudgetExceededError } from '@/modules/vision/usage-ledger';
import { enforceRateLimit } from './rate-limit';
import { SearchError } from './search-error';
import { MAX_MULTIPART_BYTES, MAX_UPLOAD_BYTES } from './upload-limits';

const filters = z.object({
  substrate: z.enum(['woven', 'knit']).nullish(),
  userBustIn: z.number().finite().positive().nullish(),
  userHipIn: z.number().finite().positive().nullish(),
  formats: z.array(DeliveryFormatSchema).optional(),
  skills: z.array(SkillLevelSchema).optional(),
}).strict().default({});
const cropBox = z.object({
  x: z.number().finite().nonnegative(), y: z.number().finite().nonnegative(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
}).strict().refine(crop => crop.x + crop.width <= 1 && crop.y + crop.height <= 1).nullish();
const searchOptions = { focusRegion: FocusRegionSchema.optional(), filters };
const urlInput = z.object({ ...searchOptions, imageUrl: z.string().url(), cropBox }).strict();
const archetypeInput = z.object({ ...searchOptions, archetypeSlug: z.string().trim().min(1) }).strict();
const uploadOptions = z.object({ ...searchOptions, cropBox }).strict();
const queryInput = z.object({ ...searchOptions, querySessionId: z.string().uuid() }).strict();

class RateLimitError extends SearchError {
  constructor(readonly retryAfterSec: number) {
    super('RATE_LIMITED', 429, 'Please wait before searching again.');
  }
}

class SearchUnavailableError extends Error {}

export async function admitPublicSearch(db: Queryable, request: Request, liveAnalysis: boolean) {
  const deployed = process.env.VERCEL === '1';
  if ((deployed || process.env.NODE_ENV === 'production') && !process.env.RATE_LIMIT_IP_SALT?.trim()) {
    throw new SearchUnavailableError();
  }
  const platformIp = deployed ? request.headers.get('x-vercel-forwarded-for')?.trim() : undefined;
  let subject = 'shared-ingress';
  if (platformIp && isIP(platformIp)) {
    subject = isIP(platformIp) === 6 ? new URL('http://[' + platformIp + ']').hostname : platformIp;
  }
  const hash = createHmac('sha256', getRateLimitIpSalt()).update(subject).digest('hex');
  const check = async (tx: Queryable, ...args: ['analyze_min' | 'analyze_hr' | 'query_min', number, number]) => {
    const result = await enforceRateLimit(tx, hash, ...args);
    if (!result.allowed) throw new RateLimitError(result.retryAfterSec);
  };
  if (liveAnalysis) {
    // Admission to the two windows is atomic, so an hourly rejection cannot consume a minute slot.
    await withTransaction(db, async tx => {
      await check(tx, 'analyze_min', 10, 60);
      await check(tx, 'analyze_hr', 40, 3600);
    });
  } else {
    await check(db, 'query_min', 120, 60);
  }
}

const invalid = () => new SearchError('INVALID_INPUT', 400, 'Check the image source, focus, crop, and search filters.');
const tooLarge = () => new SearchError('IMAGE_TOO_LARGE', 413, 'Choose a smaller image or crop closer to the garment.');

// Bound streamed requests too. A missing or understated Content-Length must not bypass the limit.
async function readBody(request: Request, byteLimit: number) {
  if (Number(request.headers.get('content-length')) > byteLimit) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) throw invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > byteLimit) {
        void reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } });
}

function contentType(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
}

async function readJson(request: Request): Promise<unknown> {
  if (contentType(request) !== 'application/json') throw invalid();
  const body = await readBody(request, 16 * 1024);
  try { return await body.json(); } catch { throw invalid(); }
}

export async function readAnalyzeRequest(request: Request) {
  if (contentType(request) !== 'multipart/form-data') {
    const body = z.union([urlInput, archetypeInput]).parse(await readJson(request));
    return 'imageUrl' in body ? { source: 'url' as const, ...body } : { source: 'archetype' as const, ...body };
  }
  const body = await readBody(request, MAX_MULTIPART_BYTES);
  let form: FormData;
  try { form = await body.formData(); } catch { throw invalid(); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || form.getAll('file').length !== 1) throw invalid();
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge();
  const options: Record<string, unknown> = {};
  for (const [name, value] of form.entries()) {
    if (name === 'file') continue;
    if (!['cropBox', 'focusRegion', 'filters'].includes(name) || typeof value !== 'string' || Object.hasOwn(options, name)) {
      throw invalid();
    }
    try { options[name] = name === 'focusRegion' ? value : JSON.parse(value); } catch { throw invalid(); }
  }
  return { source: 'upload' as const, bytes: Buffer.from(await file.arrayBuffer()), ...uploadOptions.parse(options) };
}

export async function readQueryRequest(request: Request) {
  return queryInput.parse(await readJson(request));
}

export function publicSearchError(error: unknown) {
  const respond = (status: number, code: string, message: string) => Response.json({ code, message }, { status });
  if (error instanceof SearchError) {
    return Response.json({
      code: error.code, message: error.message, availableFocusRegions: error.availableFocusRegions,
    }, {
      status: error.statusCode,
      headers: error instanceof RateLimitError ? { 'Retry-After': String(error.retryAfterSec) } : undefined,
    });
  }
  if (error instanceof z.ZodError) return respond(400, 'INVALID_INPUT', 'Check the image source, focus, crop, and search filters.');
  if (error instanceof ArchetypeUnavailableError) return respond(404, 'ARCHETYPE_UNAVAILABLE', error.message);
  if (error instanceof BudgetExceededError) {
    return respond(503, 'BUDGET_EXCEEDED', 'Live image search has reached its daily budget. Try a sample or refine your current search.');
  }
  if (error instanceof SearchUnavailableError) return respond(503, 'SEARCH_UNAVAILABLE', 'Search is temporarily unavailable.');
  return respond(500, 'SEARCH_FAILED', 'Could not complete this search. Please try again.');
}
