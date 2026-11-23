// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchetypeGallery, UploadDock } from '@/components/upload-dock';
import { readDiscoverySession } from '@/components/discovery-session';

import {referenceProfile} from './reference-profile';

const { prepare, request, push } = vi.hoisted(() => ({ prepare: vi.fn(), request: vi.fn(), push: vi.fn() }));
vi.mock('@/modules/search/client-canvas-preprocess', async importOriginal => ({
  ...await importOriginal<typeof import('@/modules/search/client-canvas-preprocess')>(),
  preprocessGarmentFileInBrowser: prepare,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const sample = {
  slug: 'belted-shirt', title: 'Belted shirtdress', caption: 'Point collar and cuffs',
  imageUrl: '/reference.webp', defaultFocusRegion: 'bodice_neckline' as const,
};
const result = { queryStatus:'ok', extractedProfile:referenceProfile, querySessionId: 'f12d04cb-09bd-4da7-8f63-51aca6bb47a1', results: [], warnings: [], relaxationHints: [] };
const prepared = { blob: new Blob(['prepared-photo'], { type: 'image/webp' }), previewDataUrl: 'data:image/webp;base64,YQ==' };
function renderDiscovery() {
  render(<><UploadDock archetypes={[sample]} /><ArchetypeGallery archetypes={[sample]} /></>);
}
function enterLink() {
  fireEvent.click(screen.getByRole('button', { name: /image url/i }));
  fireEvent.change(screen.getByRole('textbox', { name: /image url/i }), { target: { value: 'https://example.com/photo' } });
}
beforeEach(() => {
  vi.stubGlobal('fetch', request);
  request.mockImplementation(async () => Response.json(result));
  prepare.mockResolvedValue(prepared);
});
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

it('starts a sample at its curated focus and retains the first response and reference before navigation', async () => {
  renderDiscovery();
  const source = { kind: 'archetype', slug: sample.slug, title: sample.title, imageUrl: sample.imageUrl };
  const sessionAtNavigation = vi.fn();
  push.mockImplementation(() => sessionAtNavigation(readDiscoverySession(result.querySessionId)));
  fireEvent.click(screen.getByRole('button', { name: /belted shirtdress/i }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/search?q=' + result.querySessionId));
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ archetypeSlug: sample.slug, focusRegion: 'bodice_neckline', filters: {} });
  expect(sessionAtNavigation).toHaveBeenCalledWith({ result, source, focusRegion: 'bodice_neckline', filters: {} });
  expect(sessionStorage.length).toBe(1);
});

it('applies the crop to the original dropped file and posts the prepared blob with the selected focus', async () => {
  renderDiscovery();
  const file = new File(['original'], 'dress.jpg', { type: 'image/jpeg' });
  fireEvent.drop(screen.getByLabelText('Photo drop area'), { dataTransfer: { files: [file] } });
  await screen.findByAltText('Your reference photo');
  fireEvent.change(screen.getByLabelText('Part focus'), { target: { value: 'bodice_neckline' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /crop/i }));
  fireEvent.change(screen.getByRole('slider', { name: /left/i }), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find patterns' }));
  await waitFor(() => expect(push).toHaveBeenCalled());
  expect(prepare).toHaveBeenLastCalledWith(file, expect.objectContaining({ x: 0.2 }));
  const body = request.mock.calls[0][1].body as FormData;
  expect((body.get('file') as File).size).toBe(prepared.blob.size);
  expect(body.get('cropApplied')).toBe('true');
  expect(body.has('cropBox')).toBe(false);
  expect(body.get('focusRegion')).toBe('bodice_neckline');
  expect(readDiscoverySession(result.querySessionId)?.source).toEqual({ kind: 'upload', previewDataUrl: prepared.previewDataUrl, cropApplied: true });
});

it('sends direct URLs with normalized crop coordinates and guides people with post links toward screenshots', async () => {
  request.mockResolvedValueOnce(Response.json({ code: 'HTML_PAGE_URL_UNSUPPORTED' }, { status: 422 }));
  renderDiscovery();
  enterLink();
  fireEvent.click(screen.getByRole('checkbox', { name: /crop/i }));
  fireEvent.change(screen.getByRole('slider', { name: /left/i }), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find patterns' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/screenshot/i);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    imageUrl: 'https://example.com/photo', cropBox: { x: .2, y: .1, width: .7, height: .8 }, focusRegion: 'full_silhouette', filters: {},
  });
});

it('keeps the one-click gallery available when live analysis hits its cap', async () => {
  request.mockResolvedValueOnce(Response.json({ code: 'BUDGET_EXCEEDED' }, { status: 503 }));
  renderDiscovery();
  enterLink();
  fireEvent.click(screen.getByRole('button', { name: 'Find patterns' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/daily/i);
  expect(screen.getByRole('link', { name: /sample/i }).getAttribute('href')).toBe('#archetypes');
  fireEvent.click(screen.getByRole('button', { name: /belted shirtdress/i }));
  await waitFor(() => expect(push).toHaveBeenCalled());
});

it('offers an available upper-body focus after the selected region is rejected', async () => {
  request.mockResolvedValueOnce(Response.json({ code: 'REGION_UNAVAILABLE', availableFocusRegions: ['bodice_neckline'] }, { status: 422 }));
  renderDiscovery();
  enterLink();
  fireEvent.change(screen.getByLabelText('Part focus'), { target: { value: 'skirt_hemline' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find patterns' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Bodice & neckline' }));
  await waitFor(() => expect(push).toHaveBeenCalled());
  expect(JSON.parse(request.mock.calls[1][1].body).focusRegion).toBe('bodice_neckline');
});

it('keeps the newest reference when a previous analyze response arrives late', async () => {
  let finishFirst!: (response: Response) => void;
  request.mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve; }));
  renderDiscovery();
  enterLink();
  fireEvent.click(screen.getByRole('button', { name: 'Find patterns' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: /belted shirtdress/i }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  await act(async () => { finishFirst(Response.json({ ...result, querySessionId: 'older-session' })); });
  expect(push).toHaveBeenCalledTimes(1);
  expect(readDiscoverySession('older-session')).toBeNull();
});
