import { describe, expect, it } from 'vitest';
import {
  evaluateBenchmarkRun,
  type BenchmarkCase,
  type BenchmarkRun,
} from '@/modules/eval/metrics';

const benchmarkCase: BenchmarkCase = {
  id: 'full',
  description: 'Floral midi dress',
  imagePath: 'full.webp',
  focusRegion: 'full_silhouette',
  relevantGrades: { direct: 2, minorHack: 1 },
  printTrapPatternIds: ['floralTrap'],
};
const matchingRun: BenchmarkRun = {
  caseId: 'full',
  rankedPatternIds: ['direct', 'minorHack'],
  latencyMs: 100,
};

describe('benchmark scorecard', () => {
  it('measures graded relevance, first relevant rank, and case-level Top-3 contamination', () => {
    const bodiceCase: BenchmarkCase = {
      ...benchmarkCase,
      id: 'bodice',
      focusRegion: 'bodice_neckline',
      printTrapPatternIds: undefined,
    };
    const sleeveCase: BenchmarkCase = {
      ...benchmarkCase,
      id: 'sleeves',
      focusRegion: 'sleeves_armscye',
      printTrapPatternIds: ['floralTrap'],
    };
    const scorecard = evaluateBenchmarkRun(
      [benchmarkCase, bodiceCase, sleeveCase],
      [
        { caseId: 'bodice', rankedPatternIds: ['unknown', 'other', 'third', 'direct'], latencyMs: 500 },
        { caseId: 'full', rankedPatternIds: ['floralTrap', 'minorHack', 'direct'], latencyMs: 100 },
        { caseId: 'sleeves', rankedPatternIds: ['direct', 'minorHack', 'unknown', 'floralTrap'], latencyMs: 1800 },
      ],
    );
    expect(scorecard.top3RelevanceRate).toBeCloseTo(2 / 3);
    expect(scorecard.printTrapContaminationAt3).toBeCloseTo(1 / 3);
    expect(scorecard.mrr).toBeCloseTo(1.75 / 3);
    expect(scorecard.ndcgAt5).toBeCloseTo(0.647574);
    expect(scorecard.byRegion.full_silhouette).toMatchObject({ count: 1, top3RelevanceRate: 1, mrr: 0.5 });
    expect(scorecard.byRegion.full_silhouette.ndcgAt5).toBeCloseTo(0.586882);
    expect(scorecard.byRegion.bodice_neckline).toMatchObject({ count: 1, top3RelevanceRate: 0, mrr: 0.25 });
    expect(scorecard.byRegion.bodice_neckline.ndcgAt5).toBeCloseTo(0.355840);
    expect(scorecard.byRegion.sleeves_armscye).toEqual({ count: 1, top3RelevanceRate: 1, mrr: 1, ndcgAt5: 1 });
    expect(scorecard.byRegion.skirt_hemline).toEqual({ count: 0, top3RelevanceRate: 0, mrr: 0, ndcgAt5: 0 });
    expect(scorecard.latencyP50Ms).toBe(500);
    expect(scorecard.latencyP95Ms).toBe(1800);
    expect(scorecard.failedGates).toEqual(['TOP_3_RELEVANCE', 'PRINT_TRAP_CONTAMINATION_AT_3']);
    expect(scorecard.gatesPassed).toBe(false);
  });

  it('uses the five-rank cutoff and scores a case with no positive labels as zero', () => {
    const scorecard = evaluateBenchmarkRun(
      [benchmarkCase, { ...benchmarkCase, id: 'no-relevance', relevantGrades: {} }],
      [
        { ...matchingRun, rankedPatternIds: ['a', 'b', 'c', 'd', 'e', 'direct'] },
        { ...matchingRun, caseId: 'no-relevance' },
      ],
    );
    expect(scorecard.mrr).toBeCloseTo(1 / 12);
    expect(scorecard.ndcgAt5).toBe(0);
    expect(scorecard.top3RelevanceRate).toBe(0);
  });

  it('accepts exactly 85% Top-3 relevance and requires nearest-rank p95 below 3,500 ms', () => {
    const cases = Array.from({ length: 20 }, (_, index) => ({ ...benchmarkCase, id: String(index) }));
    const runs = cases.map(({ id }, index) => ({
      caseId: id,
      rankedPatternIds: index < 17 ? ['direct'] : [],
      latencyMs: index < 18 ? 100 : index === 18 ? 3499 : 4000,
    }));
    const scorecard = evaluateBenchmarkRun(cases, runs);
    expect(scorecard.top3RelevanceRate).toBe(0.85);
    expect(scorecard.latencyP95Ms).toBe(3499);
    expect(scorecard.gatesPassed).toBe(true);
    runs[18]!.latencyMs = 3500;
    expect(evaluateBenchmarkRun(cases, runs).failedGates).toEqual(['LATENCY_P95']);
  });

  it('includes empty and failed observations and blocks release for any recorded error', () => {
    const cases = Array.from({ length: 20 }, (_, index) => ({ ...benchmarkCase, id: String(index) }));
    const runs = cases.map(({ id }, index) => ({
      caseId: id,
      rankedPatternIds: index < 18 ? ['direct', 'minorHack'] : [],
      latencyMs: 100,
      error: index === 19 ? 'Extract failed' : undefined,
    }));
    const scorecard = evaluateBenchmarkRun(cases, runs);
    expect(scorecard.totalCases).toBe(20);
    expect(scorecard.top3RelevanceRate).toBe(0.9);
    expect(scorecard.mrr).toBe(0.9);
    expect(scorecard.ndcgAt5).toBe(0.9);
    expect(scorecard.failedGates).toEqual(['RUN_FAILURES']);
    expect(scorecard.gatesPassed).toBe(false);
  });

  it.each([
    { label: 'empty suite', cases: [], runs: [] },
    { label: 'missing run', cases: [benchmarkCase], runs: [] },
    { label: 'unknown run', cases: [benchmarkCase], runs: [{ ...matchingRun, caseId: 'unknown' }] },
    { label: 'duplicate case', cases: [benchmarkCase, benchmarkCase], runs: [matchingRun] },
    { label: 'sparse run array', cases: [benchmarkCase], runs: [matchingRun, ,] as BenchmarkRun[] },
    { label: 'duplicate run', cases: [benchmarkCase], runs: [matchingRun, matchingRun] },
    { label: 'nonfinite latency', cases: [benchmarkCase], runs: [{ ...matchingRun, latencyMs: Infinity }] },
    { label: 'negative latency', cases: [benchmarkCase], runs: [{ ...matchingRun, latencyMs: -1 }] },
    { label: 'duplicate ranks', cases: [benchmarkCase], runs: [{ ...matchingRun, rankedPatternIds: ['direct', 'direct'] }] },
    { label: 'empty ranked ID', cases: [benchmarkCase], runs: [{ ...matchingRun, rankedPatternIds: [''] }] },
    { label: 'failed run with hits', cases: [benchmarkCase], runs: [{ ...matchingRun, error: 'Extract failed' }] },
    { label: 'empty failure message', cases: [benchmarkCase], runs: [{ ...matchingRun, rankedPatternIds: [], error: ' ' }] },
    { label: 'invalid relevance grade', cases: [{ ...benchmarkCase, relevantGrades: { direct: 3 as 2 } }], runs: [matchingRun] },
    { label: 'overlapping labels', cases: [{ ...benchmarkCase, printTrapPatternIds: ['direct'] }], runs: [matchingRun] },
  ])('rejects $label', ({ cases, runs }) => {
    expect(() => evaluateBenchmarkRun(cases, runs)).toThrow();
  });
});
