'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CuratedArchetypeSummary } from '@/modules/catalog/archetypes-repo';
import { preprocessGarmentFileInBrowser } from '@/modules/search/client-canvas-preprocess';
import type { CropBox } from '@/modules/search/image-ingest';
import type { FocusRegion } from '@/modules/taxonomy/construction-profile';
import { analyzeDiscoverySource, saveDiscoverySession, validImageUrl, type DiscoverySource } from './discovery-session';
import './upload-dock.css';

const imageTypes = 'image/jpeg,image/png,image/webp,image/avif';
const focusLabels: Record<FocusRegion, string> = {
  full_silhouette: 'Full silhouette', bodice_neckline: 'Bodice & neckline',
  sleeves_armscye: 'Sleeves & armscye', skirt_hemline: 'Skirt & hemline',
};
type Props = { archetypes: CuratedArchetypeSummary[] };
type Prepared = Awaited<ReturnType<typeof preprocessGarmentFileInBrowser>>;
type DockError = { message: string; code?: string; availableFocusRegions?: FocusRegion[] };

function describeError(error: unknown): DockError {
  const request = error as Partial<DockError> | null;
  const messages: Record<string, string> = {
    HTML_PAGE_URL_UNSUPPORTED: 'That link opens a webpage. Take a screenshot of the garment and upload it, or paste the direct image address.',
    UNSUPPORTED_CATEGORY_V1: 'Our pattern library covers Dresses & Tops. Try a photo that clearly shows a dress or top.',
    NO_GARMENT_DETECTED: 'We couldn’t see a garment clearly. Try a photo with the neckline, sleeves or seams in view.',
    REGION_UNAVAILABLE: 'That part of the garment isn’t visible. Try one of the available focus areas.',
    BUDGET_EXCEEDED: 'Live image search has reached its daily limit.',
    RATE_LIMITED: 'You’ve made several searches in a short time. Give it a moment and try again.',
    SSRF_BLOCKED: 'Use a public HTTPS image address, or upload the photo from your device.',
  };
  return { ...request, message: messages[request?.code ?? ''] ?? request?.message ?? 'Search couldn’t finish. Please try again.' };
}

// The dock and gallery share a destination. Only the latest explicit search may navigate there.
let latestSearch: AbortController | undefined;
function useStartSearch() {
  const router = useRouter();
  const ownedRequest = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DockError | null>(null);
  useEffect(() => () => {
    ownedRequest.current?.abort();
    ownedRequest.current = null;
  }, []);

  async function start(focusRegion: FocusRegion, getSource: () => Promise<{ source: DiscoverySource; blob?: Blob }>) {
    latestSearch?.abort();
    const controller = new AbortController();
    latestSearch = ownedRequest.current = controller;
    setBusy(true);
    setError(null);
    try {
      const { source, blob } = await getSource();
      if (controller.signal.aborted) return;
      const result = await analyzeDiscoverySource(source, focusRegion, {}, controller.signal, blob);
      if (controller.signal.aborted) return;
      saveDiscoverySession({ result, source, focusRegion, filters: {} });
      router.push('/search?q=' + encodeURIComponent(result.querySessionId));
    } catch (error) {
      if (!controller.signal.aborted) setError(describeError(error));
    } finally {
      if (ownedRequest.current === controller) setBusy(false);
      if (latestSearch === controller) latestSearch = undefined;
    }
  }
  return { busy, error, setError, start };
}

function Icon({ name }: { name: 'upload' | 'url' | 'camera' | 'arrow' | 'image' }) {
  const paths = {
    upload: <><path d="M12 15V3m-4 4 4-4 4 4" /><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>,
    url: <><path d="m9.5 14.5 5-5M8 16l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 8a3.5 3.5 0 0 0 5 0l4-4a3.5 3.5 0 0 0-5-5l-1 1" /></>,
    camera: <><path d="M3 7h4l1.7-3h6.6L17 7h4v13H3z" /><circle cx="12" cy="13" r="3.5" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="1.5" /><path d="m5 18 5-5 3 3 3-4 4 5" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  };
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const initialEdges = { top: 10, right: 10, bottom: 10, left: 10 };
type Edges = typeof initialEdges;
function cropFromEdges(edges: Edges): CropBox {
  const x = edges.left / 100, y = edges.top / 100;
  return { x, y, width: Math.min(1 - x, (100 - edges.left - edges.right) / 100), height: Math.min(1 - y, (100 - edges.top - edges.bottom) / 100) };
}
function CropControls({ edges, update, disabled }: { edges: Edges; update: (edges: Edges) => void; disabled: boolean }) {
  const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
  return <fieldset className="dock-crop-controls" disabled={disabled}><legend>Trim each edge</legend>
    {(Object.keys(opposite) as (keyof Edges)[]).map(side => <label key={side}>{side} <output>{edges[side]}%</output>
      <input type="range" aria-label={side + ' crop'} min={0} max={95 - edges[opposite[side]]} value={edges[side]} onChange={e => update({ ...edges, [side]: Number(e.target.value) })} />
    </label>)}
  </fieldset>;
}
function Preview({ src, crop }: { src: string; crop: Edges | null }) {
  const style: CSSProperties | undefined = crop ? {
    inset: `${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%`,
  } : undefined;
  return <div className="dock-preview"><div><img src={src} alt="Your reference photo" referrerPolicy="no-referrer" />
    {crop && <span className="dock-crop-overlay" aria-hidden="true" style={style} />}
  </div></div>;
}


export function UploadDock({ archetypes }: Props) {
  const search = useStartSearch();
  const [mode, setMode] = useState<'photo' | 'url'>('photo');
  const [reference, setReference] = useState<{ file: File; prepared: Prepared } | null>(null);
  const [url, setUrl] = useState('');
  const [focus, setFocus] = useState<FocusRegion>('full_silhouette');
  const [preparing, setPreparing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [edges, setEdges] = useState(initialEdges);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const selectionId = useRef(0);
  const busy = preparing || search.busy;
  const ready = mode === 'photo' ? Boolean(reference) : validImageUrl(url.trim());
  const crop = cropping ? cropFromEdges(edges) : null;
  const resetCrop = () => { setCropping(false); setEdges(initialEdges); };
  async function selectFile(file?: File) {
    if (!file || search.busy) return;
    const id = ++selectionId.current;
    setMode('photo'); setPreparing(true); setReference(null); resetCrop(); search.setError(null);
    try {
      if (file.type && !imageTypes.split(',').includes(file.type)) throw new Error('Choose a JPG, PNG, WebP or AVIF photo, or take a screenshot of your garment.');
      const prepared = await preprocessGarmentFileInBrowser(file);
      if (selectionId.current === id) setReference({ file, prepared });
    } catch (error) {
      if (selectionId.current === id) {
        const issue = error instanceof DOMException ? { message: 'This photo couldn’t be opened. Try a screenshot or another image.' } : describeError(error);
        search.setError(issue);
      }
    } finally {
      if (selectionId.current === id) setPreparing(false);
    }
  }
  async function submit(event?: FormEvent, nextFocus = focus) {
    event?.preventDefault();
    if (busy) return;
    if (!ready) { search.setError({ message: 'Paste a public HTTPS image address to start searching.' }); return; }
    setFocus(nextFocus);
    await search.start(nextFocus, async () => {
      if (mode === 'url') return { source: { kind: 'url', imageUrl: url.trim(), cropBox: crop } };
      if (!reference) throw new Error('Choose a reference photo.');
      const { blob, previewDataUrl } = crop ? await preprocessGarmentFileInBrowser(reference.file, crop) : reference.prepared;
      return { source: { kind: 'upload', previewDataUrl, cropApplied: Boolean(crop && (crop.width < 1 || crop.height < 1)) }, blob };
    });
  }
  function switchMode(next: typeof mode) {
    setMode(next); resetCrop(); search.setError(null);
  }
  return <section className="upload-dock" id="upload" aria-labelledby="dock-title">
    <h2 id="dock-title">Add a reference</h2>
    <form onSubmit={submit} aria-busy={busy}>
      <div className="dock-modes" role="group" aria-label="Reference source">
        <button type="button" aria-pressed={mode === 'photo'} disabled={busy} onClick={() => switchMode('photo')}><Icon name="image" />Upload photo</button>
        <button type="button" aria-pressed={mode === 'url'} disabled={busy} onClick={() => switchMode('url')}><Icon name="url" />Image URL</button>
      </div>
      {mode === 'photo' ? <>
        <input hidden ref={inputRef} type="file" accept={imageTypes} aria-label="Choose reference photo" onChange={e => { void selectFile(e.target.files?.[0]); e.target.value = ''; }} />
        <input hidden ref={cameraRef} type="file" accept={imageTypes} capture="environment" aria-label="Capture reference photo" onChange={e => { void selectFile(e.target.files?.[0]); e.target.value = ''; }} />
        <div className={'dock-drop' + (dragging ? ' is-dragging' : '')} role="group" aria-label="Photo drop area"
          onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length > 1) { search.setError({ message: 'Choose one reference photo at a time.' }); return; } void selectFile(e.dataTransfer.files[0]); }}>
          {reference ? <Preview src={reference.prepared.previewDataUrl} crop={cropping ? edges : null} /> : <span className="dock-tray"><Icon name="upload" /></span>}
          <span className="dock-drop-title">{preparing ? 'Preparing your photo…' : reference ? reference.file.name : 'Drop your garment photo here'}</span>
          {!reference && <span className="dock-formats">JPG, PNG, WebP or AVIF</span>}
          <div className="dock-file-actions"><button className={reference ? 'dock-secondary' : 'dock-primary'} type="button" disabled={busy} onClick={() => inputRef.current?.click()}>{reference ? 'Change photo' : 'Choose photo'}</button>
            <button className="dock-camera" type="button" disabled={busy} onClick={() => cameraRef.current?.click()}><Icon name="camera" />Take photo</button></div>
        </div>
      </> : <div className="dock-url"><label htmlFor="dock-url-input">Direct image URL</label>
        <input id="dock-url-input" type="url" inputMode="url" placeholder="https://…" required disabled={busy} value={url} onChange={e => { setUrl(e.target.value); resetCrop(); search.setError(null); }} />
        <p>For a social post, upload a screenshot of the garment.</p>
        {ready && cropping && <Preview src={url.trim()} crop={edges} />}
      </div>}
      <div className="dock-settings"><label htmlFor="dock-focus">Part focus</label><select id="dock-focus" value={focus} disabled={busy} onChange={e => setFocus(e.target.value as FocusRegion)}>
        {Object.entries(focusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></div>
      {ready && <label className="dock-crop-toggle"><input type="checkbox" disabled={busy} checked={cropping} onChange={e => setCropping(e.target.checked)} />Crop to a garment</label>}
      {ready && cropping && <CropControls edges={edges} update={setEdges} disabled={busy} />}
      {search.error && <div className="dock-alert" role="alert">{search.error.message}
        {search.error.code === 'BUDGET_EXCEEDED' && archetypes.length > 0 && <> <a href="#archetypes">Explore samples</a></>}
        {search.error.availableFocusRegions?.map(region => <button type="button" key={region} onClick={() => void submit(undefined, region)}>{focusLabels[region]}</button>)}
      </div>}
      {(ready || mode === 'url') && <button type="submit" className="dock-primary dock-submit" disabled={busy}>{search.busy ? 'Finding patterns…' : 'Find patterns'}<Icon name="arrow" /></button>}
    </form>
  </section>;
}

export function ArchetypeGallery({ archetypes }: Props) {
  const search = useStartSearch();
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  if (!archetypes.length) return null;
  return <section className="archetype-gallery" id="archetypes" aria-labelledby="archetype-heading">
    <div className="archetype-intro"><h2 id="archetype-heading">Explore a silhouette</h2><p>Choose a reference to find patterns with similar construction.</p></div>
    {search.error && <p className="dock-alert" role="alert">{search.error.message}</p>}
    <div className="archetype-cards">{archetypes.map(item => <button key={item.slug} type="button" className="archetype-card" aria-label={'Find patterns for ' + item.title} disabled={search.busy}
      onClick={() => { setPendingSlug(item.slug); void search.start(item.defaultFocusRegion, async () => ({ source: { kind: 'archetype', slug: item.slug, title: item.title, imageUrl: item.imageUrl } })); }}>
      <div className="archetype-picture"><img src={item.imageUrl} alt="" loading="lazy" width="560" height="700" /></div>
      <div className="archetype-card-heading"><h3>{item.title}</h3><span><Icon name="arrow" /></span></div>
      <p>{item.caption}</p>
    </button>)}</div>
    <span className="dock-live" role="status">{search.busy ? 'Finding patterns for ' + archetypes.find(item => item.slug === pendingSlug)?.title : ''}</span>
  </section>;
}
