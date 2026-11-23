import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queryable } from '@/lib/db';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { GeminiResponseError } from '@/modules/vision/types';
import { ConfirmedUnbilledError, withBudgetedUsage } from '@/modules/vision/usage-ledger';

const { ledgerSettled } = vi.hoisted(() => ({ ledgerSettled: vi.fn() }));
vi.mock('@/modules/vision/usage-ledger', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/modules/vision/usage-ledger')>();
  return {
    ...original,
    withBudgetedUsage: vi.fn(async (_db, _reservation, call) => {
      const settlement = await call();
      ledgerSettled(settlement);
      return settlement.value;
    }),
  };
});

const db: Queryable = { query: vi.fn() };
const texts = {
  full_silhouette: 'fit and flare',
  bodice_neckline: 'v-neck',
  sleeves_armscye: 'set-in sleeve',
  skirt_hemline: 'midi length',
};

function vector(...elements: number[]): number[] {
  return [...elements, ...Array<number>(768 - elements.length).fill(0)];
}

describe('Gemini region embeddings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubEnv('GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ['RETRIEVAL_QUERY', 'midi length', 'search_embed'],
    ['RETRIEVAL_DOCUMENT', null, 'ingest_embed'],
  ] as const)('batches distinct region contents for %s', async (taskType, skirt, operation) => {
    const regionTexts = ['fit and flare', 'v-neck', 'set-in sleeve'];
    if (skirt !== null) regionTexts.push(skirt);
    const inputs = [vector(3, 4), vector(-8), vector(0, 2), vector(0, 0, 6)];
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      embeddings: inputs.slice(0, regionTexts.length).map((values) => ({ values })),
    }));
    vi.stubGlobal('fetch', fetch);

    const result = await createGeminiTextEmbedder(db).embedRegions({ ...texts, skirt_hemline: skirt }, taskType);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [[url, init]] = fetch.mock.calls;
    expect(String(url)).toMatch(/\/models\/gemini-embedding-001:batchEmbedContents$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: regionTexts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: 768,
      })),
    });
    expect(result.modelId).toBe('gemini-embedding-001');
    expect(result.vectors).toEqual({
      full: vector(0.6, 0.8),
      bodice: vector(-1),
      sleeves: vector(0, 1),
      skirt: skirt === null ? null : vector(0, 0, 1),
    });
    expect(result.inputTokens).toBeGreaterThanOrEqual(regionTexts.join('').length);
    expect(withBudgetedUsage).toHaveBeenCalledWith(db, expect.objectContaining({ operation }), expect.any(Function));
    expect(ledgerSettled).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: result.inputTokens,
      outputTokens: 0,
      estimatedCostUsd: expect.any(Number),
    }));
    const [, reservation] = vi.mocked(withBudgetedUsage).mock.calls[0];
    expect(reservation.maxCostUsd).toBeGreaterThanOrEqual(ledgerSettled.mock.calls[0][0].estimatedCostUsd);
  });

  it('uses valid reported token counts and normalizes very large finite values', async () => {
    const values = vector(Number.MAX_VALUE, Number.MAX_VALUE);
    const embedContent = vi.fn().mockResolvedValue({
      embeddings: [2, 3, 4, 5].map((tokenCount) => ({ values, statistics: { tokenCount } })),
    });
    const result = await createGeminiTextEmbedder(db, { models: { embedContent } })
      .embedRegions(texts, 'RETRIEVAL_QUERY');

    expect(result.inputTokens).toBe(14);
    expect(result.vectors.full[0]).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(...result.vectors.full)).toBeCloseTo(1);
    expect(ledgerSettled).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 14 }));
  });

  it.each([
    ['missing', undefined],
    ['zero norm', vector()],
    ['wrong dimension', [1, 2]],
    ['non-finite', vector(Infinity)],
    ['sparse', new Array<number>(768)],
  ] as const)('accounts for a successful provider call before rejecting a %s vector', async (_case, values) => {
    const embedContent = vi.fn().mockResolvedValue({
      embeddings: [vector(1), vector(1), values, vector(1)].map((entry) => ({ values: entry })),
    });
    await expect(createGeminiTextEmbedder(db, { models: { embedContent } })
      .embedRegions(texts, 'RETRIEVAL_DOCUMENT')).rejects.toBeInstanceOf(GeminiResponseError);

    expect(ledgerSettled).toHaveBeenCalledOnce();
    expect(ledgerSettled).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: expect.any(Number),
      estimatedCostUsd: expect.any(Number),
    }));
  });

  it('preflights a long multibyte region with the same model and embeds it in one batch', async () => {
    const full = 'café au lait '.repeat(180);
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ totalTokens: 2040 }))
      .mockResolvedValueOnce(Response.json({
        embeddings: [1, 2, 3, 4].map((value) => ({ values: vector(value) })),
      }));
    vi.stubGlobal('fetch', fetch);

    const result = await createGeminiTextEmbedder(db)
      .embedRegions({ ...texts, full_silhouette: full }, 'RETRIEVAL_QUERY');

    expect(Buffer.byteLength(full)).toBeGreaterThan(2048);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [[countUrl, countInit], [embedUrl, embedInit]] = fetch.mock.calls;
    expect(String(countUrl)).toMatch(/\/models\/gemini-embedding-001:countTokens$/);
    expect(JSON.parse(String(countInit?.body))).toEqual({ contents: [{ parts: [{ text: full }] }] });
    expect(String(embedUrl)).toMatch(/\/models\/gemini-embedding-001:batchEmbedContents$/);
    expect(JSON.parse(String(embedInit?.body)).requests[0].content).toEqual({ parts: [{ text: full }] });
    expect(result.inputTokens).toBe(2048 + 6 + 13 + 11 + 3 * 8);
  });

  it.each([
    ['over limit', { totalTokens: 2041 }, 200],
    ['missing', {}, 200],
    ['invalid', { totalTokens: 12.5 }, 200],
    ['failed', { error: { code: 503, message: 'unavailable' } }, 503],
  ] as const)('keeps the paid batch undispatched when the preflight count is %s', async (_case, body, status) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(body, { status }));
    vi.stubGlobal('fetch', fetch);

    await expect(createGeminiTextEmbedder(db).embedRegions(
      { ...texts, full_silhouette: 'é'.repeat(1100) },
      'RETRIEVAL_QUERY',
    )).rejects.toThrow();

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/models\/gemini-embedding-001:countTokens$/);
    expect(withBudgetedUsage).not.toHaveBeenCalled();
  });

  it('settles usage before rejecting an explicitly truncated region', async () => {
    const embeddings = [1, 2, 3, 4].map((value) => ({ values: vector(value) }));
    const embedContent = vi.fn().mockResolvedValue({
      embeddings: [{ ...embeddings[0], statistics: { truncated: true, tokenCount: 2048 } }, ...embeddings.slice(1)],
    });

    await expect(createGeminiTextEmbedder(db, { models: { embedContent } })
      .embedRegions(texts, 'RETRIEVAL_QUERY')).rejects.toBeInstanceOf(GeminiResponseError);
    expect(ledgerSettled).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 2048 + 6 + 13 + 11 + 3 * 8,
    }));
  });

  it('rejects an oversized region before reserving budget or contacting Gemini', async () => {
    const embedContent = vi.fn();
    await expect(createGeminiTextEmbedder(db, { models: { embedContent } })
      .embedRegions({ ...texts, full_silhouette: 'é'.repeat(8193) }, 'RETRIEVAL_QUERY'))
      .rejects.toThrow(/region|input/i);
    expect(withBudgetedUsage).not.toHaveBeenCalled();
    expect(embedContent).not.toHaveBeenCalled();
  });

  it.each([
    [400, true],
    [500, true],
    [503, false],
  ] as const)('attempts one paid request for HTTP %s', async (status, unbilled) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: { code: status, message: 'request failed' } }, { status }));
    vi.stubGlobal('fetch', fetch);
    const call = createGeminiTextEmbedder(db).embedRegions(texts, 'RETRIEVAL_QUERY');

    if (unbilled) {
      await expect(call).rejects.toBeInstanceOf(ConfirmedUnbilledError);
    } else {
      await expect(call).rejects.toMatchObject({ status });
    }
    expect(fetch).toHaveBeenCalledOnce();
    expect(ledgerSettled).not.toHaveBeenCalled();
  });
});
