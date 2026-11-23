import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { z } from 'zod';
import { VECTOR_DIMENSION } from '@/lib/db';
import { evaluateBenchmarkRun, type BenchmarkCase, type BenchmarkRun } from '@/modules/eval/metrics';
import { analyzeAndSearch } from '@/modules/search/analyze-service';
import { validateAndNormalizeServerImage } from '@/modules/search/image-ingest';
import { searchFiltersSchema } from '@/modules/search/public-http';
import {
  ConstructionProfileV1Schema,
  FocusRegionSchema,
  type ConstructionProfileV1,
} from '@/modules/taxonomy/construction-profile';
import type { TextEmbedder, VisionExtractor } from '@/modules/vision/types';
import { deterministicTextToVector768, seedSyntheticCatalog } from '../../supabase/seed/synthetic-catalog';

const defaultFixtureRoot = fileURLToPath(new URL('../../eval/fixtures/smoke-v1/', import.meta.url));
const migrationsDirectory = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const requiredText = z.string().trim().min(1);
const fixtureCaseSchema = z.object({
  id: requiredText,
  description: requiredText,
  imagePath: requiredText,
  profilePath: requiredText,
  focusRegion: FocusRegionSchema,
  filters: searchFiltersSchema,
  relevantGrades: z.record(slugSchema, z.union([z.literal(1), z.literal(2)]))
    .refine(grades => Object.keys(grades).length > 0, 'At least one relevance label is required'),
  printTrapPatternIds: z.array(slugSchema).optional(),
});

const manifestSchema = z.object({
  datasetId: z.literal('smoke-v1'),
  cases: z.array(fixtureCaseSchema).length(15, 'Smoke benchmark requires exactly 15 cases'),
});

type FixtureCase = z.infer<typeof fixtureCaseSchema>;
type Asset = { bytes: Buffer; sha256: string; profile: ConstructionProfileV1 };
type LoadedAsset = { asset: Asset } | { error: string };

type SmokeBenchmarkOptions = { fixtureRoot?: string };
export type SmokeBenchmarkRun = BenchmarkRun;

const modelInfo = {
  extractor: 'fixture-profile-by-normalized-sha256',
  embedder: 'deterministicTextToVector768',
  dimensions: VECTOR_DIMENSION,
};

const offlineEmbedder: TextEmbedder = {
  async embedRegions(texts) {
    return {
      vectors: {
        full: deterministicTextToVector768(texts.full_silhouette),
        bodice: deterministicTextToVector768(texts.bodice_neckline),
        sleeves: deterministicTextToVector768(texts.sleeves_armscye),
        skirt: texts.skirt_hemline ? deterministicTextToVector768(texts.skirt_hemline) : null,
      },
      inputTokens: 0,
    };
  },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fixturePath(root: string, filename: string) {
  const path = resolve(root, filename);
  const fromRoot = relative(root, path);
  if (isAbsolute(filename) || !fromRoot || fromRoot === '..' || fromRoot.startsWith('..' + sep)) {
    throw new Error(`Fixture path must stay within its dataset: ${filename}`);
  }
  return path;
}

async function loadAsset(root: string, fixture: FixtureCase): Promise<LoadedAsset> {
  try {
    const bytes = await readFile(fixturePath(root, fixture.imagePath));
    const { sha256 } = await validateAndNormalizeServerImage(bytes);
    const profileText = await readFile(fixturePath(root, fixture.profilePath), 'utf8');
    const profile = ConstructionProfileV1Schema.parse(JSON.parse(profileText));
    return { asset: { bytes, sha256, profile } };
  } catch (error) {
    return { error: `Fixture ${fixture.imagePath} / ${fixture.profilePath}: ${errorMessage(error)}` };
  }
}

function resolveLabels(fixture: FixtureCase, idBySlug: ReadonlyMap<string, string>): BenchmarkCase {
  const resolvePattern = (slug: string) => {
    const patternId = idBySlug.get(slug);
    if (!patternId) throw new Error(`Case "${fixture.id}" labels unknown catalog pattern slug "${slug}"`);
    return patternId;
  };

  const { id, description, imagePath, focusRegion, filters, relevantGrades, printTrapPatternIds } = fixture;
  return {
    id,
    description,
    imagePath,
    focusRegion,
    filters,
    relevantGrades: Object.fromEntries(Object.entries(relevantGrades)
      .map(([slug, grade]) => [resolvePattern(slug), grade])),
    printTrapPatternIds: printTrapPatternIds?.map(resolvePattern),
  };
}

export async function runSmokeBenchmark({ fixtureRoot = defaultFixtureRoot }: SmokeBenchmarkOptions = {}) {
  const manifestPath = join(fixtureRoot, 'manifest.json');
  const manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const ids = new Set<string>();
  for (const { id } of manifest.cases) {
    if (ids.has(id)) throw new Error(`Duplicate smoke benchmark case ID "${id}"`);
    ids.add(id);
  }

  const db = new PGlite({ extensions: { vector } });
  try {
    const migrations = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations) {
      await db.exec(await readFile(join(migrationsDirectory, name), 'utf8'));
    }

    await seedSyntheticCatalog(db);
    const { rows } = await db.query<{ id: string; slug: string }>('SELECT id, slug FROM patterns');
    const idBySlug = new Map(rows.map(({ id, slug }) => [slug, id]));
    const patternSlugById = Object.fromEntries(rows.map(({ id, slug }) => [id, slug]));
    const cases = manifest.cases.map(fixture => resolveLabels(fixture, idBySlug));

    // Build the extractor independently of catalog IDs, relevance grades, and print-trap labels.
    const assets = new Map<string, LoadedAsset>();
    const profileByHash = new Map<string, ConstructionProfileV1>();
    for (const fixture of manifest.cases) {
      const loaded = await loadAsset(fixtureRoot, fixture);
      assets.set(fixture.id, loaded);
      if ('error' in loaded) continue;
      const { sha256, profile } = loaded.asset;
      const existingProfile = profileByHash.get(sha256);
      if (existingProfile && JSON.stringify(existingProfile) !== JSON.stringify(profile)) {
        throw new Error(`Conflicting profile for normalized image "${fixture.imagePath}" in case "${fixture.id}"`);
      }
      profileByHash.set(sha256, profile);
    }

    const visionExtractor: VisionExtractor = {
      async extract({ images }) {
        const hash = createHash('sha256').update(images[0].bytes).digest('hex');
        const profile = profileByHash.get(hash);
        if (!profile) throw new Error('There is no extraction fixture for the normalized image');
        return { status: 'ok', profile, aiConfidence: 1, warnings: [], inputTokens: 0, outputTokens: 0 };
      },
    };

    const runs: SmokeBenchmarkRun[] = [];
    for (const { id, focusRegion, filters, imagePath } of cases) {
      const loaded = assets.get(id)!;
      if ('error' in loaded) {
        runs.push({ caseId: id, rankedPatternIds: [], latencyMs: 0, error: loaded.error });
        continue;
      }

      // Exclude harness setup from timing and still take the cold analysis path for reused images.
      await db.query('DELETE FROM query_sessions');
      const startedAt = performance.now();
      try {
        const result = await analyzeAndSearch({ db, visionExtractor, textEmbedder: offlineEmbedder }, {
          source: 'upload',
          bytes: loaded.asset.bytes,
          focusRegion,
          filters: filters ?? {},
        }, startedAt);
        runs.push({
          caseId: id,
          rankedPatternIds: result.results.map(({ patternId }) => patternId),
          latencyMs: performance.now() - startedAt,
        });
      } catch (error) {
        runs.push({
          caseId: id,
          rankedPatternIds: [],
          latencyMs: performance.now() - startedAt,
          error: `Upload ${imagePath}: ${errorMessage(error)}`,
        });
      }
    }

    return {
      cases,
      runs,
      scorecard: evaluateBenchmarkRun(cases, runs),
      modelInfo,
      timing: 'offline' as const,
      patternSlugById,
    };
  } finally {
    await db.close();
  }
}

export async function runSmokeBenchmarkSuite(options?: SmokeBenchmarkOptions) {
  return (await runSmokeBenchmark(options)).scorecard;
}
