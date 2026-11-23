import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { closeDbPool, getDbPool } from '@/lib/db';
import { getGeminiConfig } from '@/lib/env';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import { createGeminiTextEmbedder } from '@/modules/vision/gemini-text-embedder';
import { createGeminiVisionExtractor } from '@/modules/vision/gemini-vision-extractor';

// Opt in with a migrated staging DATABASE_URL and GEMINI_API_KEY. These calls incur usage.
it.skipIf(process.env.SEAMLENS_GEMINI_STAGING !== '1')(
  'extracts the original square-neck dress fixture and embeds its four construction regions',
  async () => {
    const db = getDbPool();
    try {
      const bytes = await readFile('public/catalog-media/archetypes/square-neck-puff-midi.webp');
      const started = performance.now();
      const result = await createGeminiVisionExtractor(db).extract({
        mode: 'live_query', images: [{ mimeType: 'image/webp', bytes }],
      });
      const visionMs = performance.now() - started;
      expect(result.status).toBe('ok');
      if (!result.profile) throw new Error('Vision returned no garment profile for the dress fixture');
      expect(result.profile.garment_category).toBe('dress');

      const embedStart = performance.now();
      const { vectors, inputTokens } = await createGeminiTextEmbedder(db).embedRegions(
        serializeCanonicalRegions(result.profile), 'RETRIEVAL_QUERY'
      );
      const embedMs = performance.now() - embedStart;
      for (const region of ['full', 'bodice', 'sleeves', 'skirt'] as const) {
        const vector = vectors[region];
        expect(vector).toHaveLength(768);
        expect(Math.hypot(...(vector ?? []))).toBeCloseTo(1, 6);
      }
      console.info('Gemini staging fixture', {
        ...getGeminiConfig(), status: result.status, category: result.profile.garment_category,
        neckline: result.profile.bodice_and_neckline.neckline_type, confidence: result.aiConfidence,
        visionMs, embedMs, visionInputTokens: result.inputTokens,
        visionOutputTokens: result.outputTokens, embeddingInputTokens: inputTokens,
      });
    } finally {
      await closeDbPool();
    }
  },
  90_000
);
