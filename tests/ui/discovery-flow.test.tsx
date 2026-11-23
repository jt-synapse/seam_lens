// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DiscoveryWorkspace } from '@/components/discovery-workspace';
import { saveDiscoverySession, type DiscoverySource } from '@/components/discovery-session';
import type { SearchExecutionResult } from '@/modules/search/hybrid-ranker';

import { referenceProfile } from './reference-profile';

const router = vi.hoisted(() => ({replace: vi.fn()}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); router.replace.mockReset(); sessionStorage.clear(); });

function result(title = 'Juniper dress', id = crypto.randomUUID() as string): SearchExecutionResult {
  return {
    querySessionId: id, queryStatus: 'ok', warnings: [], relaxationHints: [],
    extractedProfile: referenceProfile,
    results: [{
      patternId: 'pattern-1', viewId: 'view-1', viewLabel: 'View A', secondaryViewCount: 0,
      garmentCategory: 'dress', title, makerName: 'Juniper Studio', coverImageUrl: '/dress.webp',
      flatFrontImageUrl: null, flatBackImageUrl: null, matchedSizeBandId: 'curve', priceCents: 1800,
      currency: 'USD', bustRangeIn: [32, 60], hipRangeIn: [34, 62], designerSizeLabel: 'Curve',
      substrateType: 'woven', formats: ['pdf_a0'], skillLevel: 'intermediate', totalScore: .89,
      matchedChips: [], diffChips: [],
    }],
  };
}
const archetype: DiscoverySource = {kind:'archetype', slug:'juniper', imageUrl:'/juniper.webp', title:'Juniper reference'};
const cache = (data: SearchExecutionResult, source: DiscoverySource | null = archetype) => {
  saveDiscoverySession({result: data, source, focusRegion:'bodice_neckline', filters:{substrate:'woven'}});
};
const expired = () => Response.json({code:'SESSION_EXPIRED',message:'This session has expired.'},{status:404});
const body = (init: RequestInit) => JSON.parse(String(init.body));

it('keeps the source, focus, first matches and qualifying band across navigation without fetching', () => {
  const data = result();
  cache(data);
  const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  expect(screen.getByRole('button',{name:'Bodice & Neckline'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByAltText(/juniper reference/i).getAttribute('src')).toBe('/juniper.webp');
  expect(screen.getByText('Juniper dress')).toBeTruthy();
  const href = screen.getByRole('link',{name:/view pattern at/i}).getAttribute('href')!;
  const link = new URL(href, 'http://localhost');
  expect(link.pathname).toBe('/go/pattern-1');
  expect(link.searchParams.get('band')).toBe('curve');
  expect(link.searchParams.get('v')).toBe('view-1');
  expect(fetch).not.toHaveBeenCalled();
});

it('uses only the query endpoint and ignores a slower superseded refinement', async () => {
  const data = result(); cache(data);
  let finishFirst!: (value: Response) => void;
  const first = new Promise<Response>(resolve => { finishFirst = resolve; });
  const fetch = vi.fn()
    .mockImplementationOnce(() => first)
    .mockResolvedValueOnce(Response.json(result('Latest sleeves',data.querySessionId)));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Full Silhouette'}));
  fireEvent.click(screen.getByRole('button',{name:'Sleeves & Armscye'}));
  await screen.findByText('Latest sleeves');
  expect(fetch.mock.calls.map(([url,init]) => [url,body(init).focusRegion])).toEqual([
    ['/api/v1/search/query','full_silhouette'],['/api/v1/search/query','sleeves_armscye'],
  ]);
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finishFirst(Response.json(result('Outdated silhouette',data.querySessionId))));
  expect(screen.queryByText('Outdated silhouette')).toBeNull();
});

it.each<DiscoverySource>([
  archetype,
  {kind:'url',imageUrl:'https://example.com/inspiration.jpg',cropBox:{x:.1,y:.2,width:.4,height:.6}},
  {kind:'upload',previewDataUrl:'data:image/webp;base64,UklGRg==',cropApplied:true},
])('recovers the retained $kind once and carries the latest focus and filters to the replacement session', async source => {
  const old = result(), fresh = result('Recovered match'); cache(old,source);
  const originalFetch = globalThis.fetch;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('data:')) return originalFetch(input);
    if (url === '/api/v1/search/query') return expired();
    if (url === '/api/v1/search/analyze') {
      if (source.kind === 'upload') {
        const form = init!.body as FormData;
        expect(form.get('file')).toBeTruthy();
        expect(form.get('cropApplied')).toBe('true');
        expect(form.get('focusRegion')).toBe('sleeves_armscye');
        expect(JSON.parse(String(form.get('filters')))).toEqual({substrate:'woven'});
      } else {
        const sent = body(init!);
        expect(sent).toMatchObject({focusRegion:'sleeves_armscye',filters:{substrate:'woven'}});
        expect(sent).toMatchObject(source.kind === 'url' ? {imageUrl:source.imageUrl,cropBox:source.cropBox} : {archetypeSlug:source.slug});
      }
      return Response.json(fresh);
    }
    throw new Error('Unexpected request');
  });
  vi.stubGlobal('fetch',fetch);
  const view = render(<DiscoveryWorkspace querySessionId={old.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Sleeves & Armscye'}));
  await screen.findByText('Recovered match');
  expect(router.replace.mock.calls[0][0]).toBe('/search?q='+fresh.querySessionId);
  view.unmount();
  render(<DiscoveryWorkspace querySessionId={fresh.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Bodice & Neckline'}));
  expect(await screen.findByRole('link',{name:/upload a new image/i})).toBeTruthy();
  expect(fetch.mock.calls.filter(([url]) => url === '/api/v1/search/analyze')).toHaveLength(1);
});

it('loads a shared link from the query endpoint and offers a fresh upload on expiry without a retained source', async () => {
  const data = result('Shared match');
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(data)).mockResolvedValueOnce(expired());
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  await screen.findByText('Shared match');
  fireEvent.click(screen.getByRole('button',{name:'Sleeves & Armscye'}));
  expect((await screen.findByRole('link',{name:/upload a new image/i})).getAttribute('href')).toMatch(/^\//);
  expect(fetch.mock.calls.map(([url])=>url)).toEqual(['/api/v1/search/query','/api/v1/search/query']);
});

it('explains the catalog scope, offers available focus regions and gives crop guidance for multiple garments', () => {
  const data = result(); data.queryStatus = 'unsupported_category_v1';
  data.warnings = ['multiple_garments_detected']; data.results = [];
  saveDiscoverySession({result:data,source:archetype,focusRegion:'full_silhouette',filters:{}});
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  expect(screen.getAllByText(/dresses (?:&|and) tops/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/crop.*one garment/i)).toBeTruthy();
  expect(screen.getByRole('button',{name:'Sleeves & Armscye'})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Skirt & Hemline'})).toBeNull();
});

it('applies the suggested single-facet relaxation without clearing other filters', async () => {
  const data = result(); data.results = [];
  data.relaxationHints = [{facet:'userHipIn',resultCount:2,label:'2 matches without the hip filter'}];
  saveDiscoverySession({result:data,source:archetype,focusRegion:'full_silhouette',filters:{substrate:'knit',userHipIn:44}});
  const fetch = vi.fn().mockResolvedValue(Response.json(result('Relaxed match',data.querySessionId)));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:/2 matches without the hip filter/i}));
  await screen.findByText('Relaxed match');
  const sent = body(fetch.mock.calls[0][1]);
  expect(sent.filters.substrate).toBe('knit');
  expect(sent.filters.userHipIn ?? null).toBe(null);
});

it('offers the curated archetypes after a budget-limited recovery', async () => {
  const data = result(); cache(data,{kind:'url',imageUrl:'https://example.com/photo.jpg'});
  const fetch = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(
    Response.json({code:'BUDGET_EXCEEDED',message:'Live search has reached its daily budget.'},{status:503}));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Full Silhouette'}));
  const link = await screen.findByRole('link',{name:/archetype/i});
  expect(link.getAttribute('href')).toMatch(/^\/#/);
  expect(screen.getByRole('link',{name:/upload a new image/i})).toBeTruthy();
});

it('aborts a direct-link query when navigating to a different session', async () => {
  const one = result(), two = result('Next reference');
  const fetch = vi.fn().mockImplementationOnce(()=>new Promise(()=>{})).mockResolvedValueOnce(Response.json(two));
  vi.stubGlobal('fetch',fetch);
  const view = render(<DiscoveryWorkspace querySessionId={one.querySessionId}/>);
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
  view.rerender(<DiscoveryWorkspace querySessionId={two.querySessionId}/>);
  await screen.findByText('Next reference');
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

it('revalidates a revisited snapshot and removes its cards after failed recovery', async () => {
  const data = result('Former catalog match');
  saveDiscoverySession({result:data,source:archetype,filters:{userHipIn:40},focusRegion:'bodice_neckline'},false);
  const fetch = vi.fn().mockResolvedValueOnce(expired()).mockResolvedValueOnce(
    Response.json({code:'ARCHETYPE_UNAVAILABLE',message:'This archetype is unavailable.'},{status:404}));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Former catalog match')).toBeNull();
  expect(screen.getByRole('link',{name:/upload a new image/i})).toBeTruthy();
  expect(body(fetch.mock.calls[0][1])).toMatchObject({filters:{userHipIn:40},focusRegion:'bodice_neckline'});
});

it('sends a single number and then null for each measurement control', async () => {
  const data = result(); cache(data);
  const fetch = vi.fn().mockImplementation(async () => Response.json(data));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  for (const [name,facet,value] of [['My full bust','userBustIn',42],['My full hip','userHipIn',47]] as const) {
    await act(async () => fireEvent.change(screen.getByRole('slider',{name}),{target:{value:String(value)}}));
    expect(body(fetch.mock.calls.at(-1)![1]).filters[facet]).toBe(value);
    await act(async () => fireEvent.click(screen.getByRole('button',{name:'Set '+name.toLowerCase()+' to Any'})));
    expect(body(fetch.mock.calls.at(-1)![1]).filters[facet]).toBeNull();
  }
});

it('presents actionable relaxation hints for an upper-body match with an out-of-scope silhouette', async () => {
  const data = result();
  data.queryStatus = 'unsupported_category_v1'; data.results = [];
  data.relaxationHints = [{facet:'substrate',resultCount:4,label:'4 matches without the fabric filter'}];
  cache(data);
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(result('Sleeve block',data.querySessionId)));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:/4 matches without the fabric filter/i}));
  await screen.findByText('Sleeve block');
  expect(body(fetch.mock.calls[0][1]).focusRegion).toBe('bodice_neckline');
});

it('shows only the requested part of a retained cropped URL image', () => {
  const data = result();
  cache(data,{kind:'url',imageUrl:'https://example.org/scene.jpg',cropBox:{x:.25,y:.1,width:.5,height:.25}});
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  const photo = screen.getByRole('img',{name:/garment reference/i}) as HTMLImageElement;
  Object.defineProperties(photo,{naturalWidth:{value:800},naturalHeight:{value:1000}});
  fireEvent.load(photo);
  expect(photo.style.width).toBe('200%');
  expect(photo.style.height).toBe('400%');
  expect(photo.style.left).toBe('-50%');
  expect(photo.style.top).toBe('-40%');
});

it('offers reference context when a saved image cannot be displayed', () => {
  const data = result(); cache(data);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.error(screen.getByRole('img',{name:/juniper reference/i}));
  expect(screen.getByText(/reference image could not be displayed/i)).toBeTruthy();
  expect(screen.getByText('Juniper dress')).toBeTruthy();
});

it('restores the applied focus and matching cards after a network error', async () => {
  const data = result(); cache(data);
  vi.stubGlobal('fetch',vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')));
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Sleeves & Armscye'}));
  await screen.findByRole('alert');
  expect(screen.getByRole('button',{name:'Bodice & Neckline'}).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Juniper dress')).toBeTruthy();
});

it('offers a new upload or an archetype at a search URL without a session ID', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={null}/>);
  expect(screen.getByRole('link',{name:/upload a new image/i}).getAttribute('href')).toBe('/#upload');
  expect(screen.getByRole('link',{name:/choose an archetype/i}).getAttribute('href')).toBe('/#archetypes');
  expect(fetch).not.toHaveBeenCalled();
});

it('carries a pending focus into a rapid filter selection and ignores the older error', async () => {
  const data = result(); cache(data);
  let failFirst!: (error: Error) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve,reject) => {failFirst=reject;}))
    .mockResolvedValueOnce(Response.json(result('Knit sleeve',data.querySessionId)));
  vi.stubGlobal('fetch',fetch);
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Sleeves & Armscye'}));
  fireEvent.click(screen.getByRole('button',{name:'Knit'}));
  await screen.findByText('Knit sleeve');
  expect(body(fetch.mock.calls[1][1])).toMatchObject({focusRegion:'sleeves_armscye',filters:{substrate:'knit'}});
  await act(async () => failFirst(new Error('Late network error')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button',{name:'Knit'}).getAttribute('aria-pressed')).toBe('true');
});

it('uses refreshed category and visibility data for a revisited session', async () => {
  const before = result();
  const after = result('Top block',before.querySessionId);
  after.extractedProfile = {
    ...after.extractedProfile, garment_category:'top',
    skirt_and_hemline:{...after.extractedProfile.skirt_and_hemline, has_skirt_section:false},
  };
  saveDiscoverySession({result:before,source:archetype,focusRegion:'full_silhouette',filters:{}},false);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(after)));
  render(<DiscoveryWorkspace querySessionId={before.querySessionId}/>);
  await screen.findByText('Top block');
  expect(screen.queryByRole('button',{name:'Skirt & Hemline'})).toBeNull();
});

it('limits focus to the regions returned by the API when selected detail is unavailable', async () => {
  const data = result(); cache(data);
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({
    code:'REGION_UNAVAILABLE',message:'Choose a focus with visible garment detail.',
    availableFocusRegions:['bodice_neckline','sleeves_armscye'],
  },{status:422})));
  render(<DiscoveryWorkspace querySessionId={data.querySessionId}/>);
  fireEvent.click(screen.getByRole('button',{name:'Skirt & Hemline'}));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button',{name:'Skirt & Hemline'})).toBeNull();
  expect(screen.getByRole('button',{name:'Bodice & Neckline'}).getAttribute('aria-pressed')).toBe('true');
});
