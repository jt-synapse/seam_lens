import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import type { GenerateContentParameters } from '@google/genai';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGalleryClassifier } from '@/modules/ingestion/gallery-classifier';
import { GeminiResponseError } from '@/modules/vision/types';
import { BudgetExceededError } from '@/modules/vision/usage-ledger';

const images = ['front', 'back', 'cover', 'unrelated', 'second view'].map((image) => ({
  bytes: Buffer.from(image),
  mimeType: 'image/webp',
}));
const contextText = 'Dress pattern. View A has a round neckline. View B has a square neckline.';
const viewA = {
  viewCode: 'A',
  viewLabel: 'View A',
  images: [
    { index: 0, role: 'flat_front' },
    { index: 1, role: 'flat_back' },
    { index: 2, role: 'cover' },
  ],
};
const viewB = {
  viewCode: 'B', viewLabel: 'View B', images: [{ index: 4, role: 'cover' }],
};
const envelope = { views: [viewA, viewB], ignore: [3] };

function fakeClient(text = JSON.stringify(envelope)) {
  const generateContent = vi.fn(async (_input: GenerateContentParameters) => ({
    text,
    usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 120, thoughtsTokenCount: 30 },
  }));
  return { models: { generateContent } };
}

describe('budgeted gallery classification', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite({ extensions: { vector } });
    for (const migration of ['202611220001_init_seamlens_v1.sql', '202611220003_ai_budget.sql']) {
      await db.exec(await readFile(`supabase/migrations/${migration}`, 'utf8'));
    }
  });

  beforeEach(async () => {
    await db.exec('TRUNCATE api_usage_ledger, api_usage_reservations');
  });

  afterAll(async () => db?.close());

  it('assigns each image once and groups multiple views in one billed request', async () => {
    const client = fakeClient();
    const classify = createGalleryClassifier(db, client);
    await expect(classify({ images, contextText })).resolves.toEqual([
      { index: 0, role: 'flat_front', viewCode: 'A', viewLabel: 'View A' },
      { index: 1, role: 'flat_back', viewCode: 'A', viewLabel: 'View A' },
      { index: 2, role: 'cover', viewCode: 'A', viewLabel: 'View A' },
      { index: 3, role: 'ignore', viewCode: '', viewLabel: '' },
      { index: 4, role: 'cover', viewCode: 'B', viewLabel: 'View B' },
    ]);
    const request = client.models.generateContent.mock.calls[0]?.[0];
    expect(client.models.generateContent).toHaveBeenCalledOnce();
    expect(request).toMatchObject({
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: { properties: { views: expect.any(Object), ignore: expect.any(Object) } },
      },
      contents: [{ role: 'user', parts: [
        { text: expect.stringContaining(contextText) },
        ...images.flatMap((image, index) => [
          { text: `Image index: ${index}` },
          { inlineData: { data: image.bytes.toString('base64'), mimeType: image.mimeType } },
        ]),
      ] }],
    });
    const { rows } = await db.query('SELECT operation, input_tokens, output_tokens FROM api_usage_ledger');
    expect(rows).toEqual([{ operation: 'ingest_vision', input_tokens: 800, output_tokens: 150 }]);
  });

  it.each([
    ['duplicate index', { ...envelope, ignore: [0] }],
    ['missing index', { ...envelope, ignore: [] }],
    ['out-of-range index', { ...envelope, ignore: [99] }],
    ['negative index', { ...envelope, ignore: [-1] }],
    ['invalid role', { ...envelope, views: [viewA, { ...viewB, images: [{ index: 4, role: 'pattern_url' }] }] }],
    ['duplicate view code', { ...envelope, views: [viewA, { ...viewB, viewCode: 'A' }] }],
    ['unexpected fields', { ...envelope, extra: 'ignored?' }],
    ['oversized output', { ...envelope, ignore: [3], extra: 'x'.repeat(16 * 1024) }],
  ])('rejects %s and still settles actual paid usage', async (_case, payload) => {
    const classify = createGalleryClassifier(db, fakeClient(JSON.stringify(payload)));
    await expect(classify({ images, contextText })).rejects.toBeInstanceOf(GeminiResponseError);
    const { rows } = await db.query('SELECT operation, input_tokens, output_tokens FROM api_usage_ledger');
    expect(rows).toEqual([{ operation: 'ingest_vision', input_tokens: 800, output_tokens: 150 }]);
  });

  it('permits classifying all inputs as irrelevant', async () => {
    const client = fakeClient(JSON.stringify({ views: [], ignore: [0] }));
    await expect(createGalleryClassifier(db, client)({ images: images.slice(0, 1), contextText }))
      .resolves.toEqual([{ index: 0, role: 'ignore', viewCode: '', viewLabel: '' }]);
  });

  it('supports one full gallery of 24 images', async () => {
    const gallery = Array.from({ length: 24 }, (_, index) => images[index % images.length]);
    const client = fakeClient(JSON.stringify({ views: [], ignore: gallery.map((_, index) => index) }));
    await expect(createGalleryClassifier(db, client)({ images: gallery, contextText })).resolves.toHaveLength(24);
    expect(client.models.generateContent).toHaveBeenCalledOnce();
  });

  it.each([
    { images: [], contextText },
    { images: Array(25).fill(images[0]), contextText },
    { images: [{ ...images[0], mimeType: 'image/svg+xml' }], contextText },
    { images: [{ ...images[0], bytes: Buffer.alloc(0) }], contextText },
    { images: [{ ...images[0], bytes: Buffer.alloc(6 * 1024 * 1024 + 1) }], contextText },
    { images, contextText: 'x'.repeat(16 * 1024 + 1) },
  ])('rejects out-of-bounds input before reaching the model', async (input) => {
    const client = fakeClient();
    await expect(createGalleryClassifier(db, client)(input)).rejects.toBeInstanceOf(RangeError);
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });

  it('makes no provider call when the daily cap is exhausted', async () => {
    const client = fakeClient();
    await db.query(`SELECT public.add_api_usage((statement_timestamp() AT TIME ZONE 'UTC')::date, 'ingest_vision', 0, 0, 1000000)`);
    await expect(createGalleryClassifier(db, client)({ images, contextText })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(client.models.generateContent).not.toHaveBeenCalled();
  });
});
