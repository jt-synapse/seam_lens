'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildExplanationChips } from '@/modules/taxonomy/chips';
import { FOCUS_REGIONS, type FocusRegion } from '@/modules/taxonomy/construction-profile';
import type { SearchExecutionResult, SearchFilters } from '@/modules/search/hybrid-ranker';
import {
  analyzeDiscoverySource, consumeDiscoveryHandoff, DiscoveryRequestError, queryDiscoverySession, readDiscoverySession,
  saveDiscoverySession, type DiscoverySession, type DiscoverySource,
} from './discovery-session';
import { useImageUrlPreview } from './demo-image-preview';
import { PatternMatchCard } from './pattern-match-card';
import { SewistFilterBar } from './sewist-filter-bar';
import './discovery-workspace.css';

const focusLabels: Record<FocusRegion, string> = {
  full_silhouette: 'Full Silhouette',
  bodice_neckline: 'Bodice & Neckline',
  sleeves_armscye: 'Sleeves & Armscye',
  skirt_hemline: 'Skirt & Hemline',
};
const upperBody: FocusRegion[] = ['bodice_neckline', 'sleeves_armscye'];
type Choices = Pick<DiscoverySession, 'focusRegion' | 'filters'>;
const initialChoices: Choices = {focusRegion:'full_silhouette',filters:{}};

type Notice = {text: string; fresh: boolean; samples: boolean};
function describeError(error: unknown, needsSource = false): Notice {
  const typed = error instanceof DiscoveryRequestError ? error : null;
  const expired = typed?.code === 'SESSION_EXPIRED';
  const samples = typed?.code === 'BUDGET_EXCEEDED';
  let text = typed?.message || 'The search could not finish. Please try again.';
  if (expired) text = 'This reference session has expired. Start a new search to find patterns.';
  if (samples) text = 'Live image search has reached its daily budget. You can still search with a curated archetype.';
  if (typed?.code === 'UNSUPPORTED_CATEGORY_V1') text = 'This catalog covers dresses and tops. Choose a reference with one of these garments.';
  return {text, fresh: needsSource || expired || samples, samples};
}

function SearchNotice({notice}: {notice: Notice}) {
  return <div className="discovery-notice" role="alert">
    <p>{notice.text}</p>
    {notice.fresh && <div className="discovery-links">
      <a href="/#upload">Upload a new image <span aria-hidden="true">↗</span></a>
      {notice.samples && <a href="/#archetypes">Choose a curated archetype <span aria-hidden="true">↗</span></a>}
    </div>}
  </div>;
}

function visibleRegions(result: SearchExecutionResult) {
  if (result.queryStatus === 'unsupported_category_v1') return upperBody;
  return FOCUS_REGIONS.filter(region => region !== 'skirt_hemline' || result.extractedProfile.skirt_and_hemline.has_skirt_section);
}

function previewUrl(source: DiscoverySource): string | null {
  if (source.kind === 'upload') {
    return source.previewDataUrl.startsWith('data:image/webp;base64,') ? source.previewDataUrl : null;
  }
  try {
    const url = new URL(source.imageUrl, source.kind === 'archetype' ? window.location.origin : undefined);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (source.kind === 'archetype' && url.origin === window.location.origin)) {
      return source.imageUrl;
    }
  } catch { /* The origin may have changed or the retained URL may be malformed. */ }
  return null;
}

function ReferenceImage({source}: {source: DiscoverySource}) {
  const [size, setSize] = useState<{width: number; height: number} | null>(null);
  const [failed, setFailed] = useState(false);
  const validated = previewUrl(source);
  const externalPreview = useImageUrlPreview(validated);
  const url = source.kind === 'url' ? externalPreview : validated;
  if (failed || !url) return <p className="discovery-note">The reference image could not be displayed.</p>;
  const crop = source.kind === 'url' ? source.cropBox : null;
  const ratio = size && crop && crop.width > 0 && crop.height > 0
    ? (size.width * crop.width) / (size.height * crop.height)
    : null;
  return <div className="discovery-preview">
    <div className="discovery-photo" style={ratio ? {
      aspectRatio: ratio, width: `min(100%, ${100 * ratio}cqh)`, height: 'auto',
    } : undefined}>
      <img src={url} alt={source.kind === 'archetype' ? source.title : 'Garment reference'} referrerPolicy="no-referrer"
        onError={() => setFailed(true)} onLoad={event => {
          const {naturalWidth, naturalHeight} = event.currentTarget;
          if (crop && naturalWidth && naturalHeight) setSize({width:naturalWidth, height:naturalHeight});
        }} style={ratio && crop ? {
          position: 'absolute', width: (100 / crop.width) + '%', height: (100 / crop.height) + '%',
          left: (-100 * crop.x / crop.width) + '%', top: (-100 * crop.y / crop.height) + '%',
        } : undefined}/>
    </div>
  </div>;
}

function ReferencePanel({session, focus, options, onFocus, locked}: {
  session: DiscoverySession; focus: FocusRegion; options: readonly FocusRegion[];
  onFocus: (focus: FocusRegion) => void; locked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const {source, result} = session;
  const title = source?.kind === 'archetype' ? source.title : 'Garment reference';
  const profile = result.extractedProfile;
  const cueFocus = result.queryStatus === 'unsupported_category_v1' && focus === 'full_silhouette' ? 'bodice_neckline' : focus;
  const cues = buildExplanationChips(profile,profile,cueFocus,1).matched;
  return <aside className="discovery-reference" aria-label="Your reference">
    <h2>Your reference</h2>
    <div className="discovery-reference-card">
      {source && <ReferenceImage source={source}/>}
      <div className="discovery-details">
        {source?.kind === 'archetype' && <p className="discovery-reference-name">{title}</p>}
        {!source && <p className="discovery-note">The reference photo stays in the browser where the search began.</p>}
        <button type="button" className="discovery-drawer" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}
          aria-controls="discovery-cues">Construction cues <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
        <div id="discovery-cues" className={'discovery-cues'+(expanded ? ' is-open' : '')}>
          <h3>Construction cues</h3>
          <ul>{cues.map(cue=><li key={cue.slot}>{cue.label}</li>)}</ul>
        </div>
        <fieldset className="discovery-focus" disabled={locked}>
          <legend>Part-focus</legend>
          {options.map(region=><button type="button" key={region} aria-pressed={focus===region}
            onClick={()=>onFocus(region)}>{focusLabels[region]}</button>)}
        </fieldset>
      </div>
    </div>
  </aside>;
}

function Guidance({result, focus}: {result: SearchExecutionResult; focus: FocusRegion}) {
  const messages: string[] = [];
  if (result.queryStatus === 'unsupported_category_v1') {
    messages.push(focus === 'full_silhouette'
      ? 'Our catalog covers dresses and tops. Choose Bodice & Neckline or Sleeves & Armscye to match a visible detail.'
      : 'The full silhouette is outside our catalog of dresses and tops. These matches use the selected upper-body detail.');
  } else if (result.queryStatus === 'low_visibility_partial' || result.warnings.includes('cropped_or_ambiguous_lower_frame')) {
    messages.push('Only part of this garment is visible. Choose a part-focus or try a photo showing the full silhouette.');
  }
  for (const warning of result.warnings) {
    if (warning === 'multiple_garments_detected') {
      messages.push('Several garments are visible. Crop your reference to one garment for a closer match.');
    } else if (warning !== 'cropped_or_ambiguous_lower_frame') {
      const label = warning.replaceAll('_',' ').trim();
      if (label) messages.push(label.charAt(0).toUpperCase()+label.slice(1));
    }
  }
  return messages.length > 0 && <div className="discovery-guidance">
    {[...new Set(messages)].map(message=><p key={message}>{message}</p>)}
    {result.warnings.includes('multiple_garments_detected') && <a href="/#upload">Choose and crop a reference ↗</a>}
  </div>;
}

function SessionWorkspace({id}: {id: string | null}) {
  const router = useRouter();
  const [session,setSession] = useState<DiscoverySession | null>(null);
  const [choices,setChoices] = useState<Choices>(initialChoices);
  const [pending,setPending] = useState<'query' | 'recovery' | null>(null);
  const [notice,setNotice] = useState<Notice | null>(null);
  const [regionOptions,setRegionOptions] = useState<FocusRegion[] | null>(null);
  const request = useRef<AbortController | null>(null);

  const isFirstHandoff = useRef<boolean | null>(null);

  const loadMatches = useCallback(async (
    previous: DiscoverySession | null, currentId: string, next: Choices, refreshing: boolean,
  ) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const {signal} = controller;
    const source = previous?.source ?? null;
    let recovering = false;
    setChoices(next);
    setNotice(null);
    setPending('query');
    try {
      let result: SearchExecutionResult;
      try {
        result = await queryDiscoverySession(currentId, next.focusRegion, next.filters, signal);
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof DiscoveryRequestError && error.code === 'SESSION_EXPIRED') ||
            !source || !previous || previous.recoveryAttempted || readDiscoverySession(currentId)?.recoveryAttempted) throw error;
        saveDiscoverySession({...previous, recoveryAttempted:true}, false);
        recovering = true;
        setPending('recovery');
        result = await analyzeDiscoverySource(source, next.focusRegion, next.filters, signal);
      }
      if (signal.aborted) return;
      const updated = {result, source, ...next, recoveryAttempted: recovering || previous?.recoveryAttempted};
      saveDiscoverySession(updated, recovering);
      setSession(updated);
      if (recovering) {
        router.replace('/search?q=' + encodeURIComponent(result.querySessionId), {scroll:false});
      }
    } catch (error) {
      if (signal.aborted) return;
      const typed = error instanceof DiscoveryRequestError ? error : null;
      if (previous) setChoices({focusRegion:previous.focusRegion, filters:previous.filters});
      if (typed?.code === 'REGION_UNAVAILABLE' && typed.availableFocusRegions) {
        setRegionOptions(typed.availableFocusRegions);
      }
      const needsSource = recovering || refreshing || typed?.code === 'SESSION_EXPIRED';
      if (needsSource) setSession(null);
      setNotice(describeError(error, needsSource));
    } finally {
      if (!signal.aborted) setPending(null);
    }
  }, [router]);

  useEffect(() => {
    if (!id) return;
    const cached = readDiscoverySession(id);
    const selected = cached ? {focusRegion:cached.focusRegion, filters:cached.filters} : initialChoices;
    if (cached) {
      setSession(cached);
      setChoices(selected);
    }
    if (isFirstHandoff.current === null) isFirstHandoff.current = consumeDiscoveryHandoff(id);
    let active = true;
    if (!isFirstHandoff.current) {
      // Let a discarded Strict Mode mount cancel before sending its request.
      queueMicrotask(() => { if (active && !request.current) void loadMatches(cached, id, selected, true); });
    }
    return () => {
      active = false;
      request.current?.abort();
      request.current = null;
    };
  }, [id, loadMatches]);

  function refine(next: Choices) {
    if (session && pending !== 'recovery') void loadMatches(session, session.result.querySessionId, next, false);
  }

  const result = session?.result;
  return <main className="discovery-workspace">
    <div className="discovery-title">
      <h1>Pattern matches</h1>
      <a className="discovery-new" href="/#upload"><span aria-hidden="true">＋</span> New search</a>
    </div>
    {session && result ? <div className="discovery-layout">
      <ReferencePanel session={session} focus={choices.focusRegion} options={regionOptions ?? visibleRegions(result)}
        onFocus={focusRegion=>void refine({...choices,focusRegion})} locked={pending==='recovery'}/>
      <section className="discovery-results" aria-label="Search results">
        <fieldset className="discovery-filters" disabled={pending==='recovery'} aria-label="Refine matches">
          <SewistFilterBar filters={choices.filters} onChange={filters=>void refine({...choices,filters})}/>
        </fieldset>
        <Guidance result={result} focus={session.focusRegion}/>
        {notice && <SearchNotice notice={notice}/>}
        <div className="discovery-count" role="status">
          {pending === 'recovery' ? 'Restoring your reference…' : pending === 'query' ? 'Updating matches…' :
            result.results.length + (result.results.length===1 ? ' pattern match' : ' pattern matches')}
        </div>
        <div className="discovery-grid" aria-busy={Boolean(pending)}>
          {result.results.map((card,index)=><PatternMatchCard key={card.patternId} card={card}
            querySessionId={result.querySessionId} focusRegion={session.focusRegion} rank={index+1}/>)}
        </div>
        {result.results.length===0 && !(result.queryStatus==='unsupported_category_v1' && session.focusRegion==='full_silhouette') && <div className="discovery-empty">
          <h3>No matches for these choices</h3>
          {result.relaxationHints.length ? <div className="discovery-hints">
            {result.relaxationHints.map(hint=><button type="button" key={hint.facet} disabled={Boolean(pending)}
              onClick={()=>{
                const filters = {...choices.filters};
                delete filters[hint.facet];
                void refine({...choices,filters});
              }}>{hint.label} <span aria-hidden="true">→</span></button>)}
          </div> : <p>Try another part-focus or a different garment reference.</p>}
        </div>}
      </section>
    </div> : <div className="discovery-blank">
      {notice ? <SearchNotice notice={notice}/> : id ? <p role="status">Loading your pattern matches…</p> :
        <><h2>Choose a garment reference</h2><p>Start with a photo or a curated archetype to find sewing patterns.</p>
          <div className="discovery-links"><a href="/#upload">Upload a new image ↗</a><a href="/#archetypes">Choose an archetype ↗</a></div></>}
    </div>}
  </main>;
}

export function DiscoveryWorkspace({querySessionId}: {querySessionId: string | null}) {
  return <SessionWorkspace key={querySessionId} id={querySessionId}/>;
}
