import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FOCUS_REGIONS } from '@/modules/taxonomy/construction-profile';
import { runStagingBenchmark } from '../../scripts/eval/staging';

const fake = vi.hoisted(()=>({query:vi.fn(), upload:vi.fn(), refine:vi.fn()}));
vi.mock('@/lib/db',()=>({getDbPool:()=>({query:fake.query}), closeDbPool:async()=>{}, VECTOR_DIMENSION:768}));
vi.mock('node:timers/promises',()=>({setTimeout:async()=>{}}));
vi.mock('playwright-core',()=>({chromium:{launch:async()=>({
  newPage:async()=>({setDefaultTimeout(){},close:async()=>{}}), close:async()=>{},
})}}));

afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});

it('scores every staging case and fails cold cache hits, inconsistent rankings and model calls during refinement', async()=>{
  const dir = await mkdtemp(join(tmpdir(),'seamlens-stage-'));
  try {
    const cases = Array.from({length:50},(_,i)=>({
      id:String(i), imagePath:i+'.jpg', focusRegion:FOCUS_REGIONS[i%4], description:'Isolated test input',
      relevantGrades:{direct:2,adaptable:1}, printTrapPatternIds:['decoy'],
    }));
    await Promise.all(cases.map(c=>writeFile(join(dir,c.imagePath),'unique fixture '+c.id)));
    await writeFile(join(dir,'manifest.json'),JSON.stringify({datasetId:'release-test', gradedBy:'test curator',
      catalogEmbeddingEvidence:'test import',catalogEmbeddingModel:'gemini-embedding-001',catalogEmbeddingDimensions:768,cases}));
    vi.stubEnv('SEAMLENS_STAGING_URL','https://staging.example');
    vi.stubEnv('DATABASE_URL','local-test-double');
    let sequence = -1;
    let region = FOCUS_REGIONS[0];
    let count = 0;
    fake.query.mockImplementation(async(sql:string,params?:unknown[])=>{
      if (sql.includes('FROM patterns')) return {rows:Array.from({length:15},(_,i)=>({
        slug:['direct','adaptable','decoy'][i] ?? 'pattern-'+i, id:'p'+i, maker_id:String(i),
        view_count:20, dims:true,permissioned:true,
      }))};
      if (sql.includes('FROM api_usage_reservations')) return {rows:[{embed:count,vision:count,stamp:'now'}]};
      if (sql.includes('FROM query_sessions')) {
        expect(params?.slice(-2)).toEqual(['gemini-3.5-flash-lite','gemini-embedding-001']);
        return {rows:sequence===47 ? [] : [{id:'s'+sequence}]};
      }
      if (sql.includes('FROM search_events')) return {rows:[{latency_ms:12},{latency_ms:14}]};
      throw Error('Unexpected query '+sql);
    });
    fake.upload.mockImplementation(async(_page,_origin,_image,focus)=>{
      sequence++; count++; region=focus;
      return {sessionId:'s'+sequence, browserMs:2400,rankedPatternIds:['p0']};
    });
    fake.refine.mockImplementation(async()=>{
      if (sequence===49) count++;
      return [1,2].map(()=>({sessionId:'s'+sequence,browserMs:60,rankedPatternIds:[sequence===48?'p2':'p0'],
        request:{focusRegion:region,filters:{substrate:null}}}));
    });
    const report = await runStagingBenchmark(dir,{uploadInBrowser:fake.upload,refineInBrowser:fake.refine});
    expect(report.runs[0].error).toBeUndefined();
    expect(report.catalog).toMatchObject({houses:15,views:300});
    expect(report.scorecard).toMatchObject({totalCases:50,gatesPassed:false,top3RelevanceRate:48/50,
      failedGates:['RUN_FAILURES','BROWSER_REFINEMENT']});
    expect(report.runs[47].error).toMatch(/cold/i);
    expect(report.runs[48].error).toMatch(/cold ranking/i);
    expect(report.runs[49].refinementModelCalls).toBe(2);
    expect(report.refinement.apiP95Ms).toBe(14);
  } finally {await rm(dir,{recursive:true,force:true});}
});
