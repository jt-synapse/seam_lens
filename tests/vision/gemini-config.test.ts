import { afterEach, expect, it, vi } from 'vitest';
import { getGeminiConfig } from '@/lib/env';

afterEach(() => vi.unstubAllEnvs());

it('uses the reviewed model IDs and standard per-million token prices', () => {
  for (const key of [
    'GEMINI_VISION_MODEL', 'GEMINI_EMBEDDING_MODEL',
    'GEMINI_VISION_INPUT_USD_PER_MILLION', 'GEMINI_VISION_OUTPUT_USD_PER_MILLION',
    'GEMINI_EMBEDDING_INPUT_USD_PER_MILLION',
  ]) vi.stubEnv(key, undefined);
  expect(getGeminiConfig()).toEqual({
    visionModel: 'gemini-3.5-flash-lite',
    embeddingModel: 'gemini-embedding-001',
    visionInputUsdPerMillion: 0.30,
    visionOutputUsdPerMillion: 2.50,
    embeddingInputUsdPerMillion: 0.15,
  });
});

it('accepts a price revision and rejects invalid rates and unsupported model settings', () => {
  vi.stubEnv('GEMINI_VISION_INPUT_USD_PER_MILLION', '0.44');
  expect(getGeminiConfig().visionInputUsdPerMillion).toBe(0.44);
  vi.stubEnv('GEMINI_EMBEDDING_INPUT_USD_PER_MILLION', '-1');
  expect(() => getGeminiConfig()).toThrow();
  vi.stubEnv('GEMINI_EMBEDDING_INPUT_USD_PER_MILLION', '0.15');
  vi.stubEnv('GEMINI_EMBEDDING_MODEL', 'unpriced-model');
  expect(() => getGeminiConfig()).toThrow();
});
