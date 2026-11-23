import type { SearchFilters } from '@/modules/search/hybrid-ranker';
import { FOCUS_REGIONS, type FocusRegion } from '@/modules/taxonomy/construction-profile';

export type BenchmarkCase = {
  id: string;
  description: string;
  imagePath: string;
  focusRegion: FocusRegion;
  filters?: SearchFilters;
  relevantGrades: Record<string, 1 | 2>;
  printTrapPatternIds?: string[];
};

export type BenchmarkRun = {
  caseId: string;
  rankedPatternIds: string[];
  latencyMs: number;
  error?: string;
};

type RelevanceMetrics = {
  top3RelevanceRate: number;
  mrr: number;
  ndcgAt5: number;
};

export type BenchmarkScorecard = RelevanceMetrics & {
  totalCases: number;
  printTrapContaminationAt3: number;
  byRegion: Record<FocusRegion, RelevanceMetrics & { count: number }>;
  latencyP50Ms: number;
  latencyP95Ms: number;
  gatesPassed: boolean;
  failedGates: string[];
};

type CaseMetrics = {
  top3Hit: boolean;
  top3Trap: boolean;
  reciprocalRank: number;
  ndcgAt5: number;
};

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUniqueIdList(ids: unknown): ids is string[] {
  return Array.isArray(ids) && [...ids].every(hasText) && new Set(ids).size === ids.length;
}

function indexCases(cases: readonly BenchmarkCase[]): Map<string, BenchmarkCase> {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('Benchmark suite must contain at least one case');
  }

  const byId = new Map<string, BenchmarkCase>();
  for (const benchmarkCase of cases) {
    if (!benchmarkCase || !hasText(benchmarkCase.id)) {
      throw new Error('Benchmark case must have a nonempty ID');
    }
    const { id, focusRegion, relevantGrades, printTrapPatternIds = [] } = benchmarkCase;
    if (byId.has(id)) {
      throw new Error(`Duplicate benchmark case: ${id}`);
    }
    if (!FOCUS_REGIONS.includes(focusRegion)) {
      throw new Error(`Invalid focus region for benchmark case: ${id}`);
    }
    if (!relevantGrades || typeof relevantGrades !== 'object' || Array.isArray(relevantGrades)
      || Object.entries(relevantGrades).some(([patternId, grade]) =>
        !hasText(patternId) || (grade !== 1 && grade !== 2))) {
      throw new Error(`Invalid relevance grades for benchmark case: ${id}`);
    }
    if (!isUniqueIdList(printTrapPatternIds)
      || printTrapPatternIds.some((patternId) => Object.hasOwn(relevantGrades, patternId))) {
      throw new Error(`Invalid print-trap labels for benchmark case: ${id}`);
    }
    byId.set(id, benchmarkCase);
  }
  return byId;
}

function validateRun(
  run: BenchmarkRun,
  casesById: ReadonlyMap<string, BenchmarkCase>,
  seen: ReadonlySet<string>,
): BenchmarkCase {
  const benchmarkCase = run && casesById.get(run.caseId);
  if (!benchmarkCase) {
    throw new Error(`Unknown benchmark case in run: ${run?.caseId}`);
  }
  if (seen.has(run.caseId)) {
    throw new Error(`Duplicate benchmark run for case: ${run.caseId}`);
  }
  if (!Number.isFinite(run.latencyMs) || run.latencyMs < 0 || !isUniqueIdList(run.rankedPatternIds)) {
    throw new Error(`Invalid latency or ranked pattern IDs for benchmark case: ${run.caseId}`);
  }
  if (run.error !== undefined && (!hasText(run.error) || run.rankedPatternIds.length !== 0)) {
    throw new Error(`Failed benchmark run must include an error and an empty ranking: ${run.caseId}`);
  }
  return benchmarkCase;
}

function dcgAt5(grades: readonly number[]): number {
  return grades.slice(0, 5).reduce(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function scoreCase(benchmarkCase: BenchmarkCase, run: BenchmarkRun): CaseMetrics {
  const { relevantGrades, printTrapPatternIds = [] } = benchmarkCase;
  const grades = run.rankedPatternIds.map((id) => Object.hasOwn(relevantGrades, id) ? relevantGrades[id] : 0);
  const firstHit = grades.findIndex((grade) => grade > 0);
  const idealDcg = dcgAt5(Object.values(relevantGrades).sort((a, b) => b - a));

  return {
    top3Hit: firstHit >= 0 && firstHit < 3,
    top3Trap: run.rankedPatternIds.slice(0, 3).some((id) => printTrapPatternIds.includes(id)),
    reciprocalRank: firstHit < 0 ? 0 : 1 / (firstHit + 1),
    ndcgAt5: idealDcg === 0 ? 0 : dcgAt5(grades) / idealDcg,
  };
}

function averageRelevance(scores: readonly CaseMetrics[]): RelevanceMetrics {
  const count = scores.length || 1;
  return {
    top3RelevanceRate: scores.filter(({ top3Hit }) => top3Hit).length / count,
    mrr: scores.reduce((sum, score) => sum + score.reciprocalRank, 0) / count,
    ndcgAt5: scores.reduce((sum, score) => sum + score.ndcgAt5, 0) / count,
  };
}

export function evaluateBenchmarkRun(
  cases: readonly BenchmarkCase[],
  runs: readonly BenchmarkRun[],
): BenchmarkScorecard {
  const casesById = indexCases(cases);
  if (!Array.isArray(runs)) {
    throw new Error('Benchmark runs must be an array');
  }

  const seen = new Set<string>();
  const scoresByRegion: Record<FocusRegion, CaseMetrics[]> = {
    full_silhouette: [],
    bodice_neckline: [],
    sleeves_armscye: [],
    skirt_hemline: [],
  };
  const scores: CaseMetrics[] = [];
  for (const run of runs) {
    const benchmarkCase = validateRun(run, casesById, seen);
    seen.add(run.caseId);
    const score = scoreCase(benchmarkCase, run);
    scoresByRegion[benchmarkCase.focusRegion].push(score);
    scores.push(score);
  }
  const missing = [...casesById.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(`Missing benchmark runs for: ${missing.join(', ')}`);
  }

  const relevance = averageRelevance(scores);
  const printTrapContaminationAt3 = scores.filter(({ top3Trap }) => top3Trap).length / cases.length;
  // Nearest-rank percentiles report observed latencies, including the slowest of 15 cases at p95.
  const latencies = runs.map(({ latencyMs }) => latencyMs).sort((a, b) => a - b);
  const latencyP50Ms = latencies[Math.ceil(latencies.length * 0.5) - 1];
  const latencyP95Ms = latencies[Math.ceil(latencies.length * 0.95) - 1];

  const failedGates: string[] = [];
  if (relevance.top3RelevanceRate < 0.85) failedGates.push('TOP_3_RELEVANCE');
  if (printTrapContaminationAt3 > 0) failedGates.push('PRINT_TRAP_CONTAMINATION_AT_3');
  if (latencyP95Ms >= 3500) failedGates.push('LATENCY_P95');
  if (runs.some(({ error }) => error !== undefined)) failedGates.push('RUN_FAILURES');

  const byRegion = Object.fromEntries(FOCUS_REGIONS.map((region) => {
    const regionScores = scoresByRegion[region];
    return [region, { count: regionScores.length, ...averageRelevance(regionScores) }];
  })) as BenchmarkScorecard['byRegion'];

  return {
    totalCases: cases.length,
    ...relevance,
    printTrapContaminationAt3,
    byRegion,
    latencyP50Ms,
    latencyP95Ms,
    gatesPassed: failedGates.length === 0,
    failedGates,
  };
}
