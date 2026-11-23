import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { ThinkingLevel, type GenerateContentParameters } from '@google/genai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { createGeminiVisionExtractor } from '@/modules/vision/gemini-vision-extractor';
import { GeminiResponseError } from '@/modules/vision/types';
import { BudgetExceededError, ConfirmedUnbilledError } from '@/modules/vision/usage-ledger';

const profile = {
  schema_version: 1,
  garment_category: 'top',
  substrate_compatibility: 'woven',
  silhouette: { overall_shape: 'boxy_cropped', ease_level: 'relaxed', garment_length: 'hip_length' },
  bodice_and_neckline: {
    neckline_type: 'square', neckline_depth: 'modest_mid', collar_type: 'none',
    shaping_darts_seams: ['none_cut_straight'], waist_definition: 'no_waist_seam_continuous',
    back_detail: 'unknown',
  },
  sleeves_and_armscye: {
    armscye_construction: 'set_in', sleeve_style: 'fitted_straight', sleeve_length: 'short',
    cuff_finish: 'none_hemmed',
  },
  skirt_and_hemline: {
    has_skirt_section: false, skirt_construction: 'none_top_hem', tier_count: 0,
    slit_detail: 'none', hemline_shape: 'straight_level', pockets: [],
  },
  closures_and_details: { primary_closure: 'pullover_no_closure', finish_structure: 'unknown' },
  structural_nuance_notes: {
    bodice_neckline: 'Square neckline', sleeves_armscye: '', skirt_hemline: '',
    overall_drape_and_proportions: '',
  },
};

const images = [
  { mimeType: 'image/webp', bytes: Buffer.from('cover'), role: 'cover' },
  { mimeType: 'image/webp', bytes: Buffer.from('flat'), role: 'flat_front' },
];
const envelope = { status: 'ok', profile, aiConfidence: 0.75, warnings: [] };
const usageMetadata = {
  promptTokenCount: 1_250,
  candidatesTokenCount: 300,
  thoughtsTokenCount: 100,
  totalTokenCount: 1_650,
};

describe('Gemini vision extraction', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    for (const name of ['202611220001_init_seamlens_v1.sql', '202611220003_ai_budget.sql']) {
      await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
    }
  });

  beforeEach(async () => {
    await db.exec('TRUNCATE api_usage_ledger, api_usage_reservations');
  });

  afterAll(async () => db?.close());

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['live_query', ThinkingLevel.MINIMAL],
    ['catalog_ingestion', ThinkingLevel.MEDIUM],
  ] as const)('sends one structured request for both images in %s mode', async (mode, thinkingLevel) => {
    const generateContent = vi.fn(async (_request: GenerateContentParameters) => ({
      text: JSON.stringify(envelope), usageMetadata,
    }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });

    const result = await extractor.extract({ images, mode, contextText: 'View A' });
    expect(result).toEqual({ ...envelope, inputTokens: 1250, outputTokens: 400 });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: { properties: { profile: expect.any(Object) } },
        maxOutputTokens: expect.any(Number),
        thinkingConfig: { thinkingLevel },
      },
      contents: [{ role: 'user', parts: expect.arrayContaining([
        { inlineData: { data: 'Y292ZXI=', mimeType: 'image/webp' } },
        { inlineData: { data: 'ZmxhdA==', mimeType: 'image/webp' } },
      ]) }],
    });
  });

  it.each([
    { ...envelope, status: 'unexpected' },
    { ...envelope, aiConfidence: 1.1 },
    { ...envelope, profile: { ...profile, schema_version: 2 } },
    { ...envelope, profile: null },
    { ...envelope, status: 'no_garment_detected' },
    'not JSON',
  ])('records paid usage for invalid response %# before rejecting it', async (invalid) => {
    const generateContent = vi.fn(async () => ({
      text: typeof invalid === 'string' ? invalid : JSON.stringify(invalid), usageMetadata,
    }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });

    await expect(extractor.extract({ images, mode: 'live_query' })).rejects.toBeInstanceOf(GeminiResponseError);
    const { rows } = await db.query('SELECT operation, input_tokens, output_tokens FROM api_usage_ledger');
    expect(rows).toEqual([{ operation: 'search_vision', input_tokens: 1250, output_tokens: 400 }]);
  });

  it.each([
    { status: 'no_garment_detected', profile: null },
    { status: 'low_visibility_partial', profile },
    { status: 'unsupported_category_v1', profile },
  ])('preserves the profile for $status as supplied by the provider', async (detected) => {
    const generateContent = vi.fn(async () => ({
      text: JSON.stringify({ ...envelope, ...detected }), usageMetadata,
    }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });
    await expect(extractor.extract({ images, mode: 'live_query' })).resolves.toMatchObject(detected);
  });

  it.each([
    ['no images', { images: [] }],
    ['too many images', { images: Array.from({ length: 9 }, () => images[0]) }],
    ['empty image', { images: [{ ...images[0], bytes: Buffer.alloc(0) }] }],
    ['non-Buffer image', { images: [{ ...images[0], bytes: new Uint8Array(1) as Buffer }] }],
    ['unsupported MIME type', { images: [{ ...images[0], mimeType: 'application/pdf' }] }],
    ['oversized image', { images: [{ ...images[0], bytes: Buffer.alloc(8 * 1024 * 1024 + 1) }] }],
    ['oversized image set', { images: [
      { ...images[0], bytes: Buffer.alloc(8 * 1024 * 1024) },
      { ...images[1], bytes: Buffer.alloc(4 * 1024 * 1024 + 1) },
    ] }],
    ['oversized context', { contextText: 'é'.repeat(8193) }],
    ['oversized role', { images: [{ ...images[0], role: 'é'.repeat(129) }] }],
  ])('rejects %s before reserving budget or calling the model', async (_label, overrides) => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify(envelope), usageMetadata }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });

    await expect(extractor.extract({ images, mode: 'live_query', ...overrides })).rejects.toBeInstanceOf(RangeError);
    expect(generateContent).not.toHaveBeenCalled();
    const { rows } = await db.query('SELECT request_id FROM api_usage_reservations');
    expect(rows).toEqual([]);
  });

  it('reserves for the full multimodal context before dispatch', async () => {
    vi.stubEnv('DAILY_AI_BUDGET_USD', '0.30');
    const generateContent = vi.fn(async () => ({ text: JSON.stringify(envelope), usageMetadata }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });

    await expect(extractor.extract({ images, mode: 'live_query' })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('settles missing token metadata at the reserved ceiling', async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify(envelope) }));
    const extractor = createGeminiVisionExtractor(db, { models: { generateContent } });

    await expect(extractor.extract({ images, mode: 'catalog_ingestion' })).resolves.toMatchObject({
      inputTokens: 1_048_576, outputTokens: 8_192,
    });
    const { rows } = await db.query('SELECT operation, request_count FROM api_usage_ledger');
    expect(rows).toEqual([{ operation: 'ingest_vision', request_count: 1 }]);
  });

  it('keeps the settled extraction charge after a billed embedding response fails validation', async () => {
    const generateContent = vi.fn(async () => ({ text: JSON.stringify(envelope), usageMetadata }));
    const vision = createGeminiVisionExtractor(db, { models: { generateContent } });
    const extracted = await vision.extract({ images, mode: 'live_query' });
    if (!extracted.profile) throw new Error('Test requires an extracted construction profile');

    const embedContent = vi.fn(async () => ({ embeddings: [] }));
    const embedder = createGeminiTextEmbedder(db, { models: { embedContent } });
    const texts = serializeCanonicalRegions(extracted.profile);
    await expect(embedder.embedRegions(texts, 'RETRIEVAL_QUERY')).rejects.toBeInstanceOf(GeminiResponseError);

    const { rows } = await db.query(`
      SELECT operation, request_count, input_tokens, output_tokens
      FROM api_usage_ledger ORDER BY operation
    `);
    expect(rows).toEqual([
      { operation: 'search_embed', request_count: 1, input_tokens: expect.any(Number), output_tokens: 0 },
      { operation: 'search_vision', request_count: 1, input_tokens: 1250, output_tokens: 400 },
    ]);
  });

  it('serializes the taxonomy and thinking configuration through the installed SDK', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    const fetchRequest = vi.fn(async (_url: string, _init: RequestInit) => Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify(envelope) }] }, finishReason: 'STOP' }],
      usageMetadata,
    }));
    vi.stubGlobal('fetch', fetchRequest);

    await expect(createGeminiVisionExtractor(db).extract({ images, mode: 'catalog_ingestion' }))
      .resolves.toMatchObject({ status: 'ok', profile });
    const [url, init] = fetchRequest.mock.calls[0];
    expect(url).toContain('/models/gemini-3.5-flash-lite:generateContent');
    const body = JSON.parse(String(init.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
      maxOutputTokens: 8192,
      responseJsonSchema: {
        required: ['status', 'profile', 'aiConfidence', 'warnings'],
        properties: {
          profile: {
            type: ['object', 'null'],
            properties: {
              schema_version: { type: 'integer', enum: [1] },
              garment_category: { type: 'string', enum: ['dress', 'top'] },
              skirt_and_hemline: { properties: { tier_count: { type: 'integer', enum: [0, 1, 2, 3] } } },
            },
          },
          aiConfidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    });
    expect(body.generationConfig).not.toHaveProperty('candidateCount');
    expect(body.systemInstruction.parts[0].text).toContain('prioritize technical flats');
    expect(body.systemInstruction.parts[0].text).toContain('multiple_garments_detected');
  });

  it.each([
    { status: 400, code: 'INVALID_ARGUMENT', expected: 'released' },
    { status: 403, code: 'PERMISSION_DENIED', expected: 'released' },
    { status: 500, code: 'INTERNAL', expected: 'released' },
    { status: 503, code: 'UNAVAILABLE', expected: 'held' },
  ])('preserves the correct reservation state after an SDK HTTP $status', async ({ status, code, expected }) => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    const fetchRequest = vi.fn(async () => Response.json({ error: { code: status, message: code, status: code } }, { status }));
    vi.stubGlobal('fetch', fetchRequest);
    const extract = createGeminiVisionExtractor(db).extract({ images, mode: 'live_query' });
    if (expected === 'released') {
      await expect(extract).rejects.toBeInstanceOf(ConfirmedUnbilledError);
    } else {
      await expect(extract).rejects.toMatchObject({ status });
    }
    expect(fetchRequest).toHaveBeenCalledOnce();
    const { rows } = await db.query('SELECT status FROM api_usage_reservations');
    expect(rows).toEqual([{ status: expected }]);
  });

  it('holds the reservation when transport fails without a provider response', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');
    const error = new TypeError('fetch failed');
    const fetchRequest = vi.fn(async () => { throw error; });
    vi.stubGlobal('fetch', fetchRequest);

    await expect(createGeminiVisionExtractor(db).extract({ images, mode: 'live_query' })).rejects.toBe(error);
    expect(fetchRequest).toHaveBeenCalledOnce();
    const { rows } = await db.query('SELECT status FROM api_usage_reservations');
    expect(rows).toEqual([{ status: 'held' }]);
  });
});
