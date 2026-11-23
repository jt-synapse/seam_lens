import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ConstructionProfileV1Schema } from '@/modules/taxonomy/construction-profile';

const datasetUrl = new URL('../../eval/fixtures/smoke-v1/', import.meta.url);

describe('Stage A fixture assets', () => {
  it('supplies 15 distinct decodable inputs with valid profiles and both print traps in cross-category search', async () => {
    const manifestUrl = new URL('manifest.json', datasetUrl);
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8').catch(() => 'null'));
    expect(manifest, 'the smoke fixture manifest').not.toBeNull();
    expect(manifest.cases).toHaveLength(15);

    const hashes = await Promise.all(manifest.cases.map(async ({ imagePath, profilePath }: {
      imagePath: string;
      profilePath: string;
    }) => {
      const profile = JSON.parse(await readFile(new URL(profilePath, datasetUrl), 'utf8'));
      ConstructionProfileV1Schema.parse(profile);
      const { data, info } = await sharp(await readFile(new URL(imagePath, datasetUrl)))
        .raw().toBuffer({ resolveWithObject: true });
      expect(Math.min(info.width, info.height)).toBeGreaterThanOrEqual(256);
      return createHash('sha256').update(data).digest('hex');
    }));
    expect(new Set(hashes).size).toBe(15);

    const crossCategoryTraps = manifest.cases
      .filter((entry: { focusRegion: string }) => entry.focusRegion === 'bodice_neckline')
      .flatMap((entry: { printTrapPatternIds?: string[] }) => entry.printTrapPatternIds ?? []);
    expect(crossCategoryTraps).toEqual(expect.arrayContaining([
      'meadow-floral-crew-tee',
      'brier-plaid-camp-shirt',
    ]));
  });
});
