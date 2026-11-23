import { randomUUID } from 'node:crypto';
import { GoogleGenAI, type Content, type EmbedContentResponse } from '@google/genai';
import { VECTOR_DIMENSION, type Queryable } from '@/lib/db';
import { getGeminiApiKey, getGeminiConfig } from '@/lib/env';
import { rethrowGeminiError } from './gemini-errors';
import { GeminiResponseError, type TextEmbedder } from './types';
import { withBudgetedUsage } from './usage-ledger';

type GeminiEmbeddingModels = GoogleGenAI['models'];
type GeminiEmbeddingClient = {
  models: Pick<GeminiEmbeddingModels, 'embedContent'> & Partial<Pick<GeminiEmbeddingModels, 'countTokens'>>;
};

const REGION_INPUT_TOKEN_LIMIT = 2_048;
const REGION_INPUT_BYTE_LIMIT = 16 * 1024;
const MODEL_TOKEN_OVERHEAD = 8;

function estimateRegionInputTokens(text: string): number {
  const inputBytes = Buffer.byteLength(text, 'utf8');
  if (text.trim().length === 0 || inputBytes > REGION_INPUT_BYTE_LIMIT) {
    throw new RangeError('Gemini embedding region input is blank or exceeds the input limit');
  }
  // If Gemini omits token counts, allow one token per UTF-8 byte plus model control tokens.
  return inputBytes + MODEL_TOKEN_OVERHEAD;
}

async function preflightRegionTokens(
  models: GeminiEmbeddingClient['models'],
  model: string,
  content: Content,
): Promise<number> {
  // Count the exact role-free content sent to the embedding endpoint, which may silently truncate.
  const result = await models.countTokens?.({ model, contents: [content] });
  const count = result?.totalTokens;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    throw new GeminiResponseError('Gemini did not return a usable embedding input token count');
  }
  const inputTokens = count + MODEL_TOKEN_OVERHEAD;
  if (inputTokens > REGION_INPUT_TOKEN_LIMIT) {
    throw new RangeError('Gemini embedding region input exceeds the model token limit');
  }
  return inputTokens;
}

function inputTokensForBatch(response: EmbedContentResponse, regionTokenBounds: number[]): number {
  const embeddings = response?.embeddings;
  const hasMatchingBatch = Array.isArray(embeddings) && embeddings.length === regionTokenBounds.length;
  return regionTokenBounds.reduce((total, bound, index) => {
    const reported = hasMatchingBatch ? embeddings[index]?.statistics?.tokenCount : undefined;
    return total + (
      typeof reported === 'number'
        && Number.isSafeInteger(reported)
        && reported > 0
        && reported <= REGION_INPUT_TOKEN_LIMIT
        ? reported
        : bound
    );
  }, 0);
}

function normalizeVector(values: unknown): number[] {
  if (!Array.isArray(values) || values.length !== VECTOR_DIMENSION) {
    throw new GeminiResponseError(`Gemini embedding must have ${VECTOR_DIMENSION} dimensions`);
  }

  let maxMagnitude = 0;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new GeminiResponseError('Gemini embedding contains a non-finite value');
    }
    maxMagnitude = Math.max(maxMagnitude, Math.abs(value));
  }
  if (maxMagnitude === 0) {
    throw new GeminiResponseError('Gemini embedding has zero norm');
  }

  // Scale before computing the norm so both very small and very large values remain usable.
  const scaled = values.map((value: number) => value / maxMagnitude);
  const norm = Math.hypot(...scaled);
  return scaled.map((value) => value / norm);
}

export function createGeminiTextEmbedder(db: Queryable, client?: GeminiEmbeddingClient): TextEmbedder {
  // The SDK sends one attempt when retryOptions is omitted.
  const gemini = client ?? new GoogleGenAI({ apiKey: getGeminiApiKey(), vertexai: false });

  return {
    async embedRegions(texts, taskType) {
      const { embeddingModel, embeddingInputUsdPerMillion } = getGeminiConfig();
      const regionTexts = [texts.full_silhouette, texts.bodice_neckline, texts.sleeves_armscye];
      if (texts.skirt_hemline !== null) regionTexts.push(texts.skirt_hemline);
      const contents = regionTexts.map((text): Content => ({ parts: [{ text }] }));
      const regionTokenBounds = await Promise.all(
        regionTexts.map(estimateRegionInputTokens).map((estimate, index) =>
          estimate <= REGION_INPUT_TOKEN_LIMIT
            ? estimate
            : preflightRegionTokens(gemini.models, embeddingModel, contents[index]),
        ),
      );
      const maxInputTokens = regionTexts.length * REGION_INPUT_TOKEN_LIMIT;
      const costForTokens = (tokens: number) => tokens * embeddingInputUsdPerMillion / 1_000_000;

      const { response, inputTokens } = await withBudgetedUsage(
        db,
        {
          id: randomUUID(),
          operation: taskType === 'RETRIEVAL_QUERY' ? 'search_embed' : 'ingest_embed',
          maxCostUsd: costForTokens(maxInputTokens),
        },
        async () => {
          let response: EmbedContentResponse;
          try {
            response = await gemini.models.embedContent({
              model: embeddingModel,
              contents,
              config: { taskType, outputDimensionality: VECTOR_DIMENSION },
            });
          } catch (error) {
            rethrowGeminiError(error);
          }

          const inputTokens = inputTokensForBatch(response, regionTokenBounds);
          return {
            value: { response, inputTokens },
            inputTokens,
            outputTokens: 0,
            estimatedCostUsd: costForTokens(inputTokens),
          };
        },
      );

      // A malformed successful response can still be billed, so validate after settlement.
      const embeddings = response?.embeddings;
      if (!Array.isArray(embeddings) || embeddings.length !== regionTexts.length) {
        throw new GeminiResponseError('Gemini returned an unexpected number of region embeddings');
      }
      const [full, bodice, sleeves, skirt = null] = Array.from(embeddings, (embedding) => {
        if (embedding?.statistics?.truncated === true) {
          throw new GeminiResponseError('Gemini truncated a region embedding input');
        }
        return normalizeVector(embedding?.values);
      });
      return { modelId: embeddingModel, vectors: { full, bodice, sleeves, skirt }, inputTokens };
    },
  };
}
