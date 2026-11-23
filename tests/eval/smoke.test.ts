import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runSmokeBenchmark, runSmokeBenchmarkSuite } from '../../scripts/eval/smoke';

const fixtureRoot = fileURLToPath(new URL('../../eval/fixtures/smoke-v1/', import.meta.url));

type TestManifest = {
  cases: Array<{ id: string; relevantGrades: Record<string, 1 | 2> }>;
};

async function readManifest(path: string): Promise<TestManifest> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function withFixtureCopy<T>(run: (root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), 'seamlens-smoke-'));
  try {
    await cp(fixtureRoot, root, { recursive: true });
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('Stage A smoke benchmark', () => {
  it('passes the release gates on all fifteen offline uploads', async () => {
    const scorecard = await runSmokeBenchmarkSuite();
    expect(scorecard.totalCases).toBe(15);
    expect(scorecard.top3RelevanceRate).toBeGreaterThanOrEqual(0.85);
    expect(scorecard.printTrapContaminationAt3).toBe(0);
    expect(scorecard.latencyP95Ms).toBeLessThan(3500);
    expect(scorecard.gatesPassed).toBe(true);
  }, 30_000);

  it('ranks identical input independently of its relevance labels', async () => {
    await withFixtureCopy(async root => {
      const manifestPath = join(root, 'manifest.json');
      const manifest = await readManifest(manifestPath);
      const [first] = manifest.cases;
      const differentLabels = manifest.cases.find(entry =>
        Object.keys(entry.relevantGrades)[0] !== Object.keys(first.relevantGrades)[0]
      );
      if (!differentLabels) throw new Error('Test needs a second set of relevance labels');
      const second = {
        ...first,
        id: 'alternate-labels',
        relevantGrades: differentLabels.relevantGrades,
        printTrapPatternIds: [],
      };
      await writeFile(manifestPath, JSON.stringify({ ...manifest, cases: [first, second, ...manifest.cases.slice(2)] }));
      const { cases, runs, timing, modelInfo, patternSlugById } = await runSmokeBenchmark({ fixtureRoot: root });
      expect(Object.keys(cases[0].relevantGrades).map(id => patternSlugById[id]))
        .toEqual(Object.keys(first.relevantGrades));
      expect(cases[1].relevantGrades).not.toEqual(cases[0].relevantGrades);
      expect(runs[0].rankedPatternIds.length).toBeGreaterThan(0);
      expect(runs[1].rankedPatternIds).toEqual(runs[0].rankedPatternIds);
      expect(runs.every(run => !run.error)).toBe(true);
      expect(timing).toBe('offline');
      expect(modelInfo.dimensions).toBe(768);
    });
  }, 30_000);

  it('rejects labels that do not resolve to the seeded catalog', async () => {
    await withFixtureCopy(async root => {
      const manifestPath = join(root, 'manifest.json');
      const manifest = await readManifest(manifestPath);
      const [first] = manifest.cases;
      first.relevantGrades = { 'unknown-catalog-slug': 2 };
      await writeFile(manifestPath, JSON.stringify(manifest));
      await expect(runSmokeBenchmark({ fixtureRoot: root })).rejects.toThrow(/unknown-catalog-slug/);
    });
  }, 30_000);

  it('rejects an empty, truncated, or duplicate case list', async () => {
    await withFixtureCopy(async root => {
      const manifestPath = join(root, 'manifest.json');
      const manifest = await readManifest(manifestPath);
      const [first] = manifest.cases;
      await writeFile(manifestPath, JSON.stringify({ ...manifest, cases: [] }));
      await expect(runSmokeBenchmark({ fixtureRoot: root })).rejects.toThrow(/exactly 15/);
      await writeFile(manifestPath, JSON.stringify({ ...manifest, cases: manifest.cases.slice(0, 14) }));
      await expect(runSmokeBenchmark({ fixtureRoot: root })).rejects.toThrow(/exactly 15/);
      await writeFile(manifestPath, JSON.stringify({ ...manifest, cases: [first, first, ...manifest.cases.slice(2)] }));
      await expect(runSmokeBenchmark({ fixtureRoot: root })).rejects.toThrow(/Duplicate smoke benchmark case ID/);
    });
  }, 30_000);

  it('records broken assets as zero-hit observations and fails the suite', async () => {
    await withFixtureCopy(async root => {
      const manifestPath = join(root, 'manifest.json');
      const manifest = await readManifest(manifestPath);
      const [first] = manifest.cases;
      await writeFile(join(root, 'corrupt.webp'), 'bad image');
      await writeFile(join(root, 'invalid-profile.json'), '{}');
      await writeFile(manifestPath, JSON.stringify({
        ...manifest,
        cases: [
          first,
          { ...first, id: 'missing-image', imagePath: 'missing.webp' },
          { ...first, id: 'corrupt-image', imagePath: 'corrupt.webp' },
          { ...first, id: 'invalid-profile', profilePath: 'invalid-profile.json' },
          ...manifest.cases.slice(4),
        ],
      }));
      const { runs, scorecard } = await runSmokeBenchmark({ fixtureRoot: root });
      expect(runs[0].rankedPatternIds.length).toBeGreaterThan(0);
      expect(runs.slice(1, 4)).toMatchObject([
        { caseId: 'missing-image', rankedPatternIds: [], error: expect.stringContaining('missing.webp') },
        { caseId: 'corrupt-image', rankedPatternIds: [], error: expect.stringContaining('corrupt.webp') },
        { caseId: 'invalid-profile', rankedPatternIds: [], error: expect.stringContaining('invalid-profile.json') },
      ]);
      expect(scorecard.totalCases).toBe(15);
      expect(scorecard.gatesPassed).toBe(false);
      expect(scorecard.failedGates).toContain('RUN_FAILURES');
    });
  }, 30_000);
});
