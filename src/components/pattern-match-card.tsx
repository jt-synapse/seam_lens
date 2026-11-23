'use client';

import { useId, useState } from 'react';
import type { RankedPatternCard } from '@/modules/search/hybrid-ranker';
import type { FocusRegion } from '@/modules/taxonomy/construction-profile';
import type { MatchChip } from '@/modules/taxonomy/chips';
import { formatLabels, skillLabels } from './sewist-filter-bar';
import './pattern-match-card.css';

function measurementRange([min, max]: [number | null, number | null]) {
  if (min === null) return max === null ? null : `up to ${max}″`;
  if (max === null) return `from ${min}″`;
  return min === max ? `${min}″` : `${min}″–${max}″`;
}

function PatternImages({ card }: { card: RankedPatternCard }) {
  const [selection, select] = useState<'cover' | 'front' | 'back'>('cover');
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const images = {
    cover: card.coverImageUrl, front: card.flatFrontImageUrl, back: card.flatFrontImageUrl && card.flatBackImageUrl,
  };
  const sides = (['cover', 'front', 'back'] as const).filter(side => images[side] && !failedUrls.includes(images[side]!));
  const firstFlat = sides.find(side => side !== 'cover');
  const preferred = selection === 'back' ? firstFlat : sides[0];
  const view = sides.includes(selection) ? selection : preferred ?? sides[0];
  const showSides = view !== 'cover' && sides.includes('front') && sides.includes('back');
  return (
    <div className="pattern-media">
      {sides.map(side => {
        const url = images[side]!;
        const isCover = side === 'cover';
        return <img key={side} className={isCover ? 'pattern-cover' : 'pattern-flat'} src={url}
          loading={isCover ? undefined : 'eager'} hidden={view !== side}
          alt={`${card.title}, ${card.viewLabel} ${isCover ? 'cover' : side + ' technical flat'}`}
          onError={() => setFailedUrls(previous => [...previous, url])} />;
      })}
      {!view && <p>Image unavailable</p>}
      {sides.length > 1 && <div className="pattern-image-controls">
        {sides.includes('cover') && firstFlat && <div className="pattern-switch" role="group" aria-label="Pattern image">
          <button type="button" aria-pressed={view === 'cover'} onClick={() => select('cover')}>Cover</button>
          <button type="button" aria-pressed={view !== 'cover'} onClick={() => select(firstFlat)}>Technical flat</button>
        </div>}
        {showSides && <div className="pattern-switch" role="group" aria-label="Technical flat side">
          <button type="button" aria-pressed={view === 'front'} onClick={() => select('front')}>Front</button>
          <button type="button" aria-pressed={view === 'back'} onClick={() => select('back')}>Back</button>
        </div>}
      </div>}
    </div>
  );
}

function ChipGroup({ chips, label, kind }: { chips: MatchChip[]; label: string; kind: 'matched' | 'diff' }) {
  if (!chips.length) return null;
  return <div className={`pattern-chips pattern-chips-${kind}`}>
    <span className="pattern-chips-heading">{label}</span>
    <ul aria-label={label}>{chips.map(chip => <li key={chip.slot}>{chip.label.replace(/^Diff:\s*/i, '')}</li>)}</ul>
  </div>;
}

export function PatternMatchCard({ card, querySessionId, focusRegion, rank }: {
  card: RankedPatternCard; querySessionId: string; focusRegion: FocusRegion; rank: number;
}) {
  const titleId = useId();
  const tracking = new URLSearchParams({ band: card.matchedSizeBandId, v: card.viewId, q: querySessionId, region: focusRegion, pos: String(rank) });
  const hip = measurementRange(card.hipRangeIn);
  const price = card.priceCents === null ? null : new Intl.NumberFormat('en-US', {
    style: 'currency', currency: card.currency,
  }).format(card.priceCents / 100);
  return (
    <article className="pattern-match" aria-labelledby={titleId}>
      <PatternImages key={card.viewId} card={card} />
      <div className="pattern-body">
        <div className="pattern-maker"><span>{card.makerName}</span><span className="pattern-verified"><span aria-hidden="true">✓</span> Verified Atelier</span></div>
        <div className="pattern-title"><h3 id={titleId}>{card.title}</h3>{price && <span>{price}</span>}</div>
        <p className="pattern-view">
          <span>{card.garmentCategory === 'dress' ? 'Dress' : 'Top'} · </span>{card.viewLabel}
          {card.secondaryViewCount > 0 && <span> · {card.secondaryViewCount} other {card.secondaryViewCount === 1 ? 'view' : 'views'}</span>}
        </p>
        <div className="pattern-specs">
          <p><span>Bust {measurementRange(card.bustRangeIn)}</span>{hip && <span> · Hip {hip}</span>}</p>
          {card.designerSizeLabel && <p>Designer sizes · {card.designerSizeLabel}</p>}
          <p>{({ woven: 'Woven', knit: 'Knit', both: 'Woven or knit' } as const)[card.substrateType]} · {skillLabels[card.skillLevel]}</p>
          {card.formats.length > 0 && <p>{card.formats.map(format => formatLabels[format]).join(' · ')}</p>}
        </div>
        <ChipGroup kind="matched" label="Matched" chips={card.matchedChips} />
        <ChipGroup kind="diff" label="Diff / Minor Hack" chips={card.diffChips} />
        <a className="pattern-outbound" href={`/go/${encodeURIComponent(card.patternId)}?${tracking}`}>
          View pattern at {card.makerName}<span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
