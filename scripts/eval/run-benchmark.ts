import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runSmokeBenchmark } from './smoke';
import { runStagingBenchmark } from './staging';

export { runSmokeBenchmarkSuite } from './smoke';

type Results = Awaited<ReturnType<typeof runSmokeBenchmark>> | Awaited<ReturnType<typeof runStagingBenchmark>>;
type Report = {
  stage:'A'|'B'; status:'passed'|'failed'|'pending'; generatedAt:string;
} & (Results | {scorecard:null; reason:string});

function renderMarkdown(report: Report) {
  const lines = [`# Stage ${report.stage} benchmark`, '', `Status: **${report.status}**  `, `Generated: ${report.generatedAt}`, ''];
  if (!report.scorecard) return [...lines, report.reason, ''].join('\n');
  const {scorecard:s, modelInfo:m} = report;
  lines.push(`Timing: ${report.timing}. Extractor: \`${m.extractor}\`. Embedder: \`${m.embedder}\` (${m.dimensions} dimensions).`, '',
    '| Cases | Top-3 relevance | Print-trap@3 | MRR | NDCG@5 | p50 ms | p95 ms |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${s.totalCases} | ${(100*s.top3RelevanceRate).toFixed(1)}% | ${(100*s.printTrapContaminationAt3).toFixed(1)}% | ${s.mrr.toFixed(3)} | ${s.ndcgAt5.toFixed(3)} | ${s.latencyP50Ms.toFixed(1)} | ${s.latencyP95Ms.toFixed(1)} |`, '',
    '| Focus region | Cases | Top-3 relevance | MRR | NDCG@5 |', '| --- | ---: | ---: | ---: | ---: |');
  for (const [region,r] of Object.entries(s.byRegion)) {
    lines.push(`| ${region} | ${r.count} | ${(100*r.top3RelevanceRate).toFixed(1)}% | ${r.mrr.toFixed(3)} | ${r.ndcgAt5.toFixed(3)} |`);
  }
  if ('refinement' in report) {
    const r = report.refinement;
    lines.push('', `Catalog: ${report.catalog.houses} permissioned houses and ${report.catalog.views} views.`,
      `Refinements: ${r.count}. Browser p95: ${r.browserP95Ms?.toFixed(1) ?? 'unavailable'} ms (target <100 ms each). API p95: ${r.apiP95Ms ?? 'unavailable'} ms (target <80 ms).`);
  } else lines.push('', 'Stage A uses synthetic profiles and deterministic embeddings. The live release decision depends on Stage B.');
  if (s.failedGates.length) lines.push('', 'Failed gates: ' + s.failedGates.join(', '));
  lines.push('', 'Individual rankings, graded judgments, trap labels and query errors are in the accompanying JSON scorecard.', '');
  return lines.join('\n');
}

export async function runCli(args:string[]) {
  const mode = args[0];
  const input = mode === '--dataset' ? args[1] : undefined;
  const tail = args.slice(input ? 2 : 1);
  if ((mode !== '--smoke' && mode !== '--dataset') || (mode === '--dataset' && (!input || input.startsWith('--'))) ||
      !(tail.length === 0 || (tail.length === 2 && tail[0] === '--out' && tail[1] && !tail[1].startsWith('--')))) {
    console.error('Usage: bun run eval:benchmark (--smoke | --dataset DIRECTORY) [--out DIRECTORY]');
    return 2;
  }
  const stage = mode === '--smoke' ? 'A' : 'B';
  const dir = resolve(tail[1] ?? 'eval/reports');
  let report:Report;
  const generatedAt = new Date().toISOString();
  try {
    const result = input ? await runStagingBenchmark(input) : await runSmokeBenchmark();
    report = {...result, stage, generatedAt, status:result.scorecard.gatesPassed ? 'passed' : 'failed'};
  } catch (error) {
    report = {stage, generatedAt, status:stage === 'B' ? 'pending' : 'failed',
      scorecard:null, reason:String(error instanceof Error ? error.message : error)};
  }
  await mkdir(dir, {recursive:true});
  const prefix = join(dir,'stage-'+stage.toLowerCase());
  for (const [ext, contents] of [['json',JSON.stringify(report,null,2)+'\n'], ['md',renderMarkdown(report)]]) {
    const file = prefix+'.'+ext;
    const temp = file+'.'+randomUUID()+'.tmp';
    await writeFile(temp,contents);
    await rename(temp,file);
  }
  console.log(renderMarkdown(report).trimEnd());
  console.log('Reports: '+prefix+'.{json,md}');
  return report.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCli(process.argv.slice(2)).then(code=>{ process.exitCode = code; })
    .catch(error=>{ console.error(error); process.exitCode = 1; });
}
