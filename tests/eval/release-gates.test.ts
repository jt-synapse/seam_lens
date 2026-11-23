import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateStagingEvidence, loadStagingManifest } from '../../scripts/eval/staging';
import { runCli } from '../../scripts/eval/run-benchmark';

it('keeps Stage B pending and emits both reports when the permissioned dataset is absent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'seamlens-eval-'));
  try {
    expect(await runCli(['--dataset', join(dir, 'missing'), '--out', dir])).toBe(1);
    expect(JSON.parse(await readFile(join(dir, 'stage-b.json'), 'utf8'))).toMatchObject({
      stage: 'B', status: 'pending', scorecard: null,
    });
    expect(await readFile(join(dir, 'stage-b.md'), 'utf8')).toContain('manifest.json');
    await expect(loadStagingManifest(dir)).rejects.toThrow(/manifest.json/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('requires repeated browser refinements, zero model calls and browser p95 below 100 ms', () => {
  const samples = [{browserMs: 78, apiMs: 36}, {browserMs: 81, apiMs: 40}];
  expect(evaluateStagingEvidence([{refinements:samples,refinementModelCalls:0}])).toMatchObject({
    passed: true, browserP95Ms:81, apiP95Ms:40, apiTargetMs:80,
  });
  for (const row of [
    {refinements:samples.slice(0,1),refinementModelCalls:0},
    {refinements:samples,refinementModelCalls:1},
    {refinements:[...samples,{browserMs:100,apiMs:80}],refinementModelCalls:0},
    {refinements:[],refinementModelCalls:0},
  ]) expect(evaluateStagingEvidence([row]).passed).toBe(false);
  expect(evaluateStagingEvidence([]).passed).toBe(false);
});
