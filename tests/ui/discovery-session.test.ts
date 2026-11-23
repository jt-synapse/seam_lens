// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { analyzeDiscoverySource, readDiscoverySession, saveDiscoverySession, queryDiscoverySession } from '@/components/discovery-session';
import type { SearchExecutionResult } from '@/modules/search/hybrid-ranker';

import {referenceProfile} from './reference-profile';

const result = {
  querySessionId: 'bcd2b7c4-e2ea-463f-9d8c-0ea58bb87aca', queryStatus: 'ok', warnings: [],
  extractedProfile: referenceProfile, results: [], relaxationHints: [],
} satisfies SearchExecutionResult;
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('retains a session across navigation and can recover a cropped upload without cropping it again', async () => {
  const source = {kind:'upload',cropApplied:true,previewDataUrl:'data:image/webp;base64,AQID'} as const;
  const session = {result, source, focusRegion:'bodice_neckline' as const,filters:{userBustIn:40}};
  saveDiscoverySession(session);
  expect(readDiscoverySession(result.querySessionId)).toEqual(session);
  expect(sessionStorage.length).toBeGreaterThan(0);
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) => Response.json(result));
  vi.stubGlobal('fetch',fetcher);
  expect(await analyzeDiscoverySource(source,session.focusRegion,session.filters)).toEqual(result);
  const [url,options] = fetcher.mock.calls[0];
  expect(url).toBe('/api/v1/search/analyze');
  const form = options.body as FormData;
  expect(form.get('cropApplied')).toBe('true');
  expect(form.has('cropBox')).toBe(false);
  expect((form.get('file') as Blob).size).toBe(3);
  expect(form.get('filters')).toBe('{"userBustIn":40}');
});

it('preserves typed error guidance for unavailable focus regions', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code:'REGION_UNAVAILABLE',message:'Choose another region.',availableFocusRegions:['bodice_neckline']},{status:422})));
  await expect(queryDiscoverySession(result.querySessionId,'skirt_hemline',{})).rejects.toMatchObject({
    code:'REGION_UNAVAILABLE',availableFocusRegions:['bodice_neckline'],
  });
});

it('keeps the result available in memory when the browser denies storage', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(()=>{throw new Error('Storage unavailable');});
  const session = {result,source:null,focusRegion:'full_silhouette' as const,filters:{}};
  saveDiscoverySession(session);
  expect(readDiscoverySession(result.querySessionId)).toEqual(session);
});

it('restores a valid URL reference after reload and ignores damaged snapshots', () => {
  const id = '6fe9c23f-c654-466d-b09a-66c255f26558';
  const key = 'seamlens:discovery:v1:' + id;
  const snapshot = {
    result: { ...result, querySessionId: id },
    source: { kind: 'url', imageUrl: 'HTTPS://example.org/reference.jpg' },
    focusRegion: 'full_silhouette',
    filters: {},
  };
  sessionStorage.setItem(key, JSON.stringify(snapshot));
  expect(readDiscoverySession(id)).toEqual(snapshot);
  sessionStorage.setItem(key, JSON.stringify({ ...snapshot, result: { ...snapshot.result, extractedProfile: {} } }));
  expect(readDiscoverySession(id)).toBeNull();
});

it('reports an unreadable response when the server returns an incomplete match', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...result, results: [{ title: 'A dress' }] })));
  await expect(queryDiscoverySession(result.querySessionId, 'full_silhouette', {}))
    .rejects.toMatchObject({ code: 'SEARCH_FAILED' });
});
