import sharp from 'sharp';
import type { Queryable } from '@/lib/db';
import { demoBishopFixture, demoCowlFixture } from '@/lib/local-demo-fixtures';
import type { GalleryClassifier } from '@/modules/ingestion/gallery-classifier';
import { ConstructionProfileV1Schema } from '@/modules/taxonomy/construction-profile';
import { deterministicTextToVector768 } from './deterministic-text-vector';
import type { TextEmbedder, VisionExtractor } from './types';
import { recordApiUsage, type UsageOperation } from './usage-ledger';

const fixtures = [demoCowlFixture, demoBishopFixture];
const visionModel = 'seamlens-local-demo-fixture-v1';

// Small RGB fingerprints tolerate rescaling and JPEG/WebP encoding of the same illustration.
// A close fingerprint selects an authored fixture. The demo does not infer construction from pixels.
function imageFingerprint(bytes: Buffer) {
  return sharp(bytes).resize(16, 16, { fit: 'fill' }).flatten({ background: '#ffffff' })
    .toColourspace('srgb').removeAlpha().raw().toBuffer();
}

let fixtureFingerprints: Promise<Buffer[]> | undefined;

function meanPixelDifference(left: Buffer, right: Buffer) {
  let distance = 0;
  for (const [index, channel] of left.entries()) distance += Math.abs(channel - right[index]);
  return distance / left.length;
}

function recordDemoUsage(db: Queryable, operation: UsageOperation, inputTokens: number, outputTokens = 0) {
  return recordApiUsage(db, { operation, inputTokens, outputTokens, estimatedCostUsd: 0 });
}

export function createDemoVisionExtractor(db: Queryable): VisionExtractor {
  return {
    async extract({ images, mode }) {
      const reference = images.find(image => image.role === 'cover') ?? images[0];
      fixtureFingerprints ??= Promise.all(fixtures.map(async fixture => imageFingerprint(await fixture.readImage())));
      const [fingerprint, known] = await Promise.all([imageFingerprint(reference.bytes), fixtureFingerprints]);
      const match = fixtures[known.findIndex(sample => meanPixelDifference(sample, fingerprint) <= 5)];
      const fixture = match ?? demoCowlFixture;
      const profile = ConstructionProfileV1Schema.parse(fixture.profile);
      const inputTokens = images.length * 256;
      const outputTokens = 128;
      await recordDemoUsage(db, mode === 'live_query' ? 'search_vision' : 'ingest_vision', inputTokens, outputTokens);
      return {
        status: 'ok', profile, modelId: visionModel, aiConfidence: 0, inputTokens, outputTokens,
        warnings: [match
          ? 'Bundled demo sample. Details come from a predefined construction profile.'
          : 'Demo fallback. This image did not match a bundled illustration. Results use the sample cowl-dress profile.'],
      };
    },
  };
}

export function createDemoTextEmbedder(db: Queryable): TextEmbedder {
  return {
    async embedRegions(texts, taskType) {
      const inputTokens = Object.values(texts).reduce((sum, text) => sum + Math.ceil((text?.length ?? 0) / 4), 0);
      await recordDemoUsage(db, taskType === 'RETRIEVAL_QUERY' ? 'search_embed' : 'ingest_embed', inputTokens);
      return {
        modelId: 'deterministicTextToVector768',
        inputTokens,
        vectors: {
          full: deterministicTextToVector768(texts.full_silhouette),
          bodice: deterministicTextToVector768(texts.bodice_neckline),
          sleeves: deterministicTextToVector768(texts.sleeves_armscye),
          skirt: texts.skirt_hemline === null ? null : deterministicTextToVector768(texts.skirt_hemline),
        },
      };
    },
  };
}

export function createDemoGalleryClassifier(db: Queryable): GalleryClassifier {
  return async ({ images }) => {
    await recordDemoUsage(db, 'ingest_vision', images.length * 256, 32);
    return images.map((_, index) => index === 0
      ? { index, role: 'cover', viewCode: 'default', viewLabel: 'Default' }
      : { index, role: 'ignore', viewCode: '', viewLabel: '' });
  };
}
