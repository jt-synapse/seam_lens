import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { z } from 'zod';
import { closeDbPool, getDbPool, VECTOR_DIMENSION, type Queryable } from '@/lib/db';
import { getGeminiConfig } from '@/lib/env';
import { evaluateBenchmarkRun, type BenchmarkCase, type BenchmarkRun } from '@/modules/eval/metrics';
import { searchFiltersSchema } from '@/modules/search/public-http';
import { FOCUS_REGIONS, FocusRegionSchema } from '@/modules/taxonomy/construction-profile';
import { refineInBrowser, uploadInBrowser } from './browser';

const note = z.string().trim().min(1);
const caseSchema = z.object({
  id:note, description:note, imagePath:note, focusRegion:FocusRegionSchema,
  filters:searchFiltersSchema, relevantGrades:z.record(z.union([z.literal(1),z.literal(2)])),
  printTrapPatternIds:z.array(note).default([]),
});
const manifestSchema = z.object({
  datasetId:note, gradedBy:note, catalogEmbeddingModel:note.optional(), catalogEmbeddingDimensions:z.number().int().optional(),
  catalogEmbeddingEvidence:note.optional(), cases:z.array(caseSchema).min(50).max(100),
});

export async function loadStagingManifest(dir: string) {
  const file = resolve(dir, 'manifest.json');
  const raw = await readFile(file, 'utf8').catch(error => {
    if (error?.code === 'ENOENT') throw new Error('Missing permissioned dataset manifest.json in ' + dir);
    throw error;
  });
  const manifest = manifestSchema.parse(JSON.parse(raw));
  const root = await realpath(dir);
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const grades = new Set<number>();
  for (const c of manifest.cases) {
    const entries = Object.entries(c.relevantGrades);
    if (!entries.length || ids.has(c.id) || new Set(c.printTrapPatternIds).size !== c.printTrapPatternIds.length ||
        c.printTrapPatternIds.some(slug => Object.hasOwn(c.relevantGrades,slug))) {
      throw new Error('Missing, overlapping or duplicate judgments for ' + c.id);
    }
    const {formats = [], skills = []} = c.filters;
    if (new Set(formats).size !== formats.length || new Set(skills).size !== skills.length ||
        [c.filters.userBustIn, c.filters.userHipIn].some(n=> n != null && (n < 32 || !Number.isInteger(n * 10)))) {
      throw new Error('Filters must be selectable in the discovery workspace: ' + c.id);
    }
    ids.add(c.id);
    entries.forEach(([,grade]) => grades.add(grade));
    const image = await realpath(resolve(root,c.imagePath));
    const path = relative(root, image);
    if (isAbsolute(c.imagePath) || path.startsWith('..'+sep) || path === '..') throw new Error('Image outside dataset: ' + c.id);
    const hash = createHash('sha256').update(await readFile(image)).digest('hex');
    if (hashes.has(hash)) throw new Error('Duplicate query image: ' + c.id);
    hashes.add(hash);
  }
  if (grades.size !== 2 || !manifest.cases.some(c=>c.printTrapPatternIds.length) ||
      !FOCUS_REGIONS.every(region=>manifest.cases.some(c=>c.focusRegion===region))) {
    throw new Error('Supply both relevance grades, labeled print traps and cases in all four focus regions.');
  }
  return manifest;
}

type RefinementEvidence = {
  refinements: {browserMs:number; apiMs:number}[];
  refinementModelCalls:number;
};

export function evaluateStagingEvidence(rows: RefinementEvidence[]) {
  const all = rows.flatMap(r=>r.refinements);
  const p95 = (values:number[]) => values.length ?
    [...values].sort((a,b)=>a-b)[Math.ceil(values.length * 0.95)-1] : null;
  return {
    count:all.length, browserP95Ms:p95(all.map(r=>r.browserMs)), apiP95Ms:p95(all.map(r=>r.apiMs)),
    apiTargetMs:80, browserTargetMs:100,
    passed: rows.length > 0 && rows.every(r => r.refinements.length >= 2 && r.refinementModelCalls === 0) &&
      all.every(r => Number.isFinite(r.browserMs) && r.browserMs >= 0 && r.browserMs < 100 && Number.isFinite(r.apiMs) && r.apiMs >= 0),
  };
}

async function usage(db: Queryable) {
  // Includes held and released reservations to detect unsuccessful model attempts as well as billed calls.
  const {rows:[counts]} = await db.query<{vision:number; embed:number; stamp:string}>(
    `SELECT count(*) FILTER (WHERE operation='search_vision')::int AS vision,
            count(*) FILTER (WHERE operation='search_embed')::int AS embed, clock_timestamp()::text AS stamp
     FROM api_usage_reservations`);
  return counts;
}

const canonicalFilters = (filters:BenchmarkCase['filters'] = {}) => ({
  substrate:filters.substrate ?? null, userBustIn:filters.userBustIn ?? null, userHipIn:filters.userHipIn ?? null,
  formats:filters.formats ?? [], skills:filters.skills ?? [],
});

type BrowserActions = {uploadInBrowser:typeof uploadInBrowser; refineInBrowser:typeof refineInBrowser};
async function measureCase(browser:Browser, db:Queryable, origin:string, dir:string, c:BenchmarkCase,
  models:Pick<ReturnType<typeof getGeminiConfig>,'visionModel'|'embeddingModel'>, browserActions:BrowserActions) {
  let page: Page | undefined;
  const run: BenchmarkRun & RefinementEvidence = {caseId:c.id, rankedPatternIds:[], latencyMs:0, refinements:[], refinementModelCalls:0};
  const started = performance.now();
  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    const before = await usage(db);
    const cold = await browserActions.uploadInBrowser(page, origin, resolve(dir,c.imagePath), c.focusRegion);
    run.latencyMs = cold.browserMs;
    const after = await usage(db);
    const {rows:[session]} = await db.query(
      'SELECT id FROM query_sessions WHERE id=$1 AND created_at >= $2::timestamptz AND vision_model=$3 AND embedding_model=$4',
      [cold.sessionId, before.stamp, models.visionModel, models.embeddingModel]);
    if (!session || after.vision-before.vision !== 1 || after.embed-before.embed !== 1) {
      throw new Error('Cold analysis or live model provenance unverified. Use distinct photos and an isolated staging database with expired prior sessions.');
    }
    const refinements = await browserActions.refineInBrowser(page, c.filters);
    const end = await usage(db);
    run.refinementModelCalls = end.vision-after.vision + end.embed-after.embed;
    const {rows:events} = await db.query<{latency_ms:number}>(
      `SELECT latency_ms FROM search_events WHERE query_session_id=$1 AND source_type='filter_refinement' ORDER BY created_at,id`, [cold.sessionId]);
    if (events.length !== refinements.length || refinements.some(r=>r.sessionId!==cold.sessionId)) {
      throw new Error('Refinement telemetry did not match this browser session.');
    }
    run.refinements = refinements.map((r,i)=>({browserMs:r.browserMs,apiMs:events[i].latency_ms}));
    const last = refinements[refinements.length-1];
    if (last.request.focusRegion !== c.focusRegion ||
        !isDeepStrictEqual(canonicalFilters(last.request.filters), canonicalFilters(c.filters))) {
      throw new Error('The rendered ranking used different filters or focus from the case judgments.');
    }
    const filtered = !isDeepStrictEqual(canonicalFilters(c.filters), canonicalFilters());
    if (!filtered && !isDeepStrictEqual(last.rankedPatternIds, cold.rankedPatternIds)) {
      throw new Error('Restoring the original focus and filters changed the cold ranking.');
    }
    run.rankedPatternIds = filtered ? last.rankedPatternIds : cold.rankedPatternIds;
  } catch (error) {
    run.error = String(error instanceof Error ? error.message : error);
    if (!run.latencyMs) run.latencyMs = performance.now()-started;
  } finally { await page?.close().catch(()=>{}); }
  return run;
}

export async function runStagingBenchmark(dir: string, browserActions = {uploadInBrowser, refineInBrowser}) {
  const manifest = await loadStagingManifest(dir);
  if (!process.env.SEAMLENS_STAGING_URL || !process.env.DATABASE_URL) {
    throw new Error('Set SEAMLENS_STAGING_URL and DATABASE_URL for the same isolated staging deployment.');
  }
  const url = new URL(process.env.SEAMLENS_STAGING_URL);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) {
    throw new Error('Use HTTPS for a remote staging deployment.');
  }
  const models = getGeminiConfig();
  const {visionModel, embeddingModel} = models;
  if ((manifest.catalogEmbeddingModel && manifest.catalogEmbeddingModel !== embeddingModel) ||
      (manifest.catalogEmbeddingDimensions !== undefined && manifest.catalogEmbeddingDimensions !== VECTOR_DIMENSION)) {
    throw new Error('Catalog embedding provenance differs from the live query model or dimensions.');
  }
  const db = getDbPool();
  try {
    const {rows:catalog} = await db.query<{id:string; slug:string; maker_id:string; view_count:number; permissioned:boolean; dims:boolean}>(
      `SELECT p.id, p.slug, m.id AS maker_id, count(*)::int AS view_count,
         (nullif(trim(m.permission_evidence_note),'') IS NOT NULL AND m.storefront_url !~* '[.]example([/:?#]|$)') AS permissioned,
         bool_and(v.embedding_model IS NOT DISTINCT FROM $1::text AND vector_dims(v.vec_full)=768 AND vector_dims(v.vec_bodice)=768 AND vector_dims(v.vec_sleeves)=768
           AND (v.vec_skirt IS NULL OR vector_dims(v.vec_skirt)=768)) AS dims
       FROM patterns p JOIN makers m ON p.maker_id=m.id JOIN pattern_views v ON v.pattern_id=p.id
       WHERE m.vetted_status='approved' AND p.status='published' AND EXISTS (SELECT 1 FROM pattern_size_bands b WHERE b.pattern_id=p.id)
       GROUP BY p.id,m.id`, [embeddingModel]);
    const houses = new Set(catalog.map(r=>r.maker_id)).size;
    const views = catalog.reduce((n,r)=>n+r.view_count,0);
    if (houses < 15 || houses > 25 || views < 300 || views > 500 || catalog.some(r=>!r.permissioned || !r.dims)) {
      throw new Error(`Staging has ${houses} active houses and ${views} views. Require 15–25 permissioned houses and 300–500 live embedded views.`);
    }
    const ids = new Map(catalog.map(r=>[r.slug,r.id]));
    const idFor = (slug:string) => {
      const id = ids.get(slug);
      if (!id) throw new Error('Unknown active pattern slug: ' + slug);
      return id;
    };
    const cases: BenchmarkCase[] = manifest.cases.map(c=>({...c,
      relevantGrades:Object.fromEntries(Object.entries(c.relevantGrades).map(([slug,grade])=>[idFor(slug),grade])),
      printTrapPatternIds:c.printTrapPatternIds.map(idFor),
    }));
    const browser = await chromium.launch(process.env.SEAMLENS_CHROME_PATH ?
      {executablePath:process.env.SEAMLENS_CHROME_PATH} : {channel:'chrome'});
    try {
      const runs: (BenchmarkRun & RefinementEvidence)[] = [];
      for (const c of cases) {
        // The public endpoint allows 40 analyses per hour from one IP.
        if (runs.length) await delay(91_000);
        const run = await measureCase(browser, db, url.origin, dir, c, models, browserActions);
        runs.push(run);
      }
      const scorecard = evaluateBenchmarkRun(cases,runs);
      const refinement = evaluateStagingEvidence(runs);
      if (!refinement.passed) {
        scorecard.gatesPassed = false;
        scorecard.failedGates.push('BROWSER_REFINEMENT');
      }
      return {cases, runs, scorecard, refinement, catalog:{houses,views,embeddingEvidence:manifest.catalogEmbeddingEvidence},
        datasetId:manifest.datasetId, gradedBy:manifest.gradedBy, patternSlugById:Object.fromEntries(catalog.map(r=>[r.id,r.slug])),
        timing:'browser submission to painted results', modelInfo:{extractor:visionModel,embedder:embeddingModel,dimensions:VECTOR_DIMENSION}};
    } finally { await browser.close(); }
  } finally { await closeDbPool(); }
}
