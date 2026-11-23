import type { CanonicalRegionTexts } from '@/modules/taxonomy/canonical-serializer';
import type { ConstructionProfileV1 } from '@/modules/taxonomy/construction-profile';

export type RegionVectors = {
  full: number[];
  bodice: number[];
  sleeves: number[];
  skirt: number[] | null;
};

export type VisionExtractionMode = 'live_query' | 'catalog_ingestion';

export type VisionExtractionResult = {
  modelId?: string;
  status: 'ok' | 'no_garment_detected' | 'unsupported_category_v1' | 'low_visibility_partial';
  profile: ConstructionProfileV1 | null;
  aiConfidence: number;
  warnings: string[];
  inputTokens: number;
  outputTokens: number;
};

export type VisionExtractor = {
  extract(input: {
    images: Array<{ mimeType: string; bytes: Buffer; role?: string }>;
    contextText?: string;
    mode: VisionExtractionMode;
  }): Promise<VisionExtractionResult>;
};

export type TextEmbedder = {
  embedRegions(
    texts: CanonicalRegionTexts,
    taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT',
  ): Promise<{ modelId?: string; vectors: RegionVectors; inputTokens: number }>;
};

export class GeminiResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GeminiResponseError';
  }
}
