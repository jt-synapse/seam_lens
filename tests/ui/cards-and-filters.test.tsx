// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { PatternMatchCard } from '@/components/pattern-match-card';
import { SewistFilterBar } from '@/components/sewist-filter-bar';
import type { RankedPatternCard, SearchFilters } from '@/modules/search/hybrid-ranker';

afterEach(cleanup);

const card: RankedPatternCard = {
  patternId: 'pattern-2', viewId: 'view-b', viewLabel: 'View B', secondaryViewCount: 2,
  garmentCategory: 'dress', title: 'Mallow Dress', makerName: 'Oat Studio',
  coverImageUrl: '/cover.webp', flatFrontImageUrl: '/front.webp', flatBackImageUrl: '/back.webp',
  matchedSizeBandId: 'curve', priceCents: 1450, currency: 'GBP',
  bustRangeIn: [31.5, 65], hipRangeIn: [34, 69], designerSizeLabel: '0–18 / 18–32',
  substrateType: 'both', formats: ['pdf_a4_letter', 'pdf_a0'], skillLevel: 'confident_beginner',
  totalScore: 0.85, matchedChips: [{ kind: 'matched', slot: 'sleeve_style', label: 'Puff Sleeve' }],
  diffChips: [{ kind: 'diff', slot: 'cuff_finish', label: 'Diff: Elastic vs. Cuffed' }],
};
const attribution = { querySessionId: 'session-5', focusRegion: 'sleeves_armscye', rank: 3 } as const;

it('warms the supplied flats and switches the displayed image between cover, front and back', () => {
  render(<PatternMatchCard card={card} {...attribution} />);
  expect(screen.getByRole('img')).toHaveAttribute('src', '/cover.webp');
  for (const src of ['/front.webp', '/back.webp']) {
    expect(document.querySelector(`img[src="${src}"]`)).toHaveAttribute('loading', 'eager');
  }
  fireEvent.click(screen.getByRole('button', { name: 'Technical flat' }));
  expect(screen.getByRole('img', { name: /front/i })).toHaveAttribute('src', '/front.webp');
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('img', { name: /back/i })).toHaveAttribute('src', '/back.webp');
  fireEvent.click(screen.getByRole('button', { name: 'Cover' }));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/cover.webp');
});

it('returns to the front flat when the back fails and to the cover when both flats fail', () => {
  render(<PatternMatchCard card={card} {...attribution} />);
  fireEvent.click(screen.getByRole('button', { name: 'Technical flat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/front.webp');
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/cover.webp');
  expect(screen.queryByRole('button', { name: 'Technical flat' })).toBeNull();
});

it('keeps working drawings and the maker link available if the cover fails', () => {
  render(<PatternMatchCard card={card} {...attribution} />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/front.webp');
  expect(screen.queryByRole('button', { name: 'Cover' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/back.webp');
  fireEvent.error(screen.getByRole('img'));
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByText(/image unavailable/i)).toBeVisible();
  expect(screen.getByRole('link', { name: /view pattern at oat studio/i })).toBeVisible();
});

it('shows only available drawing controls and never fabricates missing hip or price data', () => {
  const { rerender } = render(<PatternMatchCard card={{ ...card, flatBackImageUrl: null }} {...attribution} />);
  fireEvent.click(screen.getByRole('button', { name: 'Technical flat' }));
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  rerender(<PatternMatchCard card={{ ...card, flatFrontImageUrl: null, hipRangeIn: [null, null], priceCents: null }} {...attribution} />);
  expect(screen.queryByRole('button', { name: 'Technical flat' })).toBeNull();
  expect(screen.getByRole('img')).toHaveAttribute('src', '/cover.webp');
  expect(screen.queryByText(/hip/i)).toBeNull();
  expect(screen.queryByText(/£/)).toBeNull();
});

it('displays the full grading, maker, matched view, price and construction evidence and attributes the qualifying band', () => {
  render(<PatternMatchCard card={card} {...attribution} />);
  expect(screen.getByText('Oat Studio')).toBeVisible();
  expect(screen.getByText(/^Dress ·$/)).toBeVisible();
  for (const label of ['Mallow Dress', 'Verified Atelier', 'View B', '2 other views', '£14.50', '0–18 / 18–32', 'Puff Sleeve', 'Elastic vs. Cuffed', 'Woven or knit', 'Confident beginner']) {
    expect(screen.getByText(label, { exact: false })).toBeVisible();
  }
  expect(screen.getByText(/Bust 31.5″–65″/)).toBeVisible();
  expect(screen.getByText(/Hip 34″–69″/)).toBeVisible();
  const destination = new URL((screen.getByRole('link', { name: /View pattern at Oat Studio/i }) as HTMLAnchorElement).href);
  expect(destination.pathname).toBe('/go/pattern-2');
  expect(Object.fromEntries(destination.searchParams)).toEqual({ band: 'curve', v: 'view-b', q: 'session-5', region: 'sleeves_armscye', pos: '3' });
});

function FilterHarness() {
  const [filters, setFilters] = useState<SearchFilters>({});
  return <><SewistFilterBar filters={filters} onChange={setFilters} /><pre data-testid="filters">{JSON.stringify(filters)}</pre></>;
}

it('sets independent single measurements in inches and clears either with Any', () => {
  render(<FilterHarness />);
  const bust = screen.getByRole('slider', { name: 'My full bust' });
  const hip = screen.getByRole('slider', { name: 'My full hip' });
  expect(bust).toHaveAccessibleDescription();
  expect(bust).toHaveAttribute('aria-valuetext', 'Any');
  fireEvent.change(bust, { target: { value: '48.5' } });
  fireEvent.change(hip, { target: { value: '32' } });
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual({ userBustIn: 48.5, userHipIn: 32 });
  for (const name of ['My full bust', 'My full hip']) {
    fireEvent.click(within(screen.getByRole('group', { name })).getByRole('button', { name: /any/i }));
  }
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual({ userBustIn: null, userHipIn: null });
});

it('selects one substrate and multiple formats and skill levels without clearing unrelated facets', () => {
  render(<FilterHarness />);
  const toggle = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  ['Woven', 'Knit', 'PDF A4/Letter', 'Copyshop A0', 'Intermediate', 'Confident beginner'].forEach(toggle);
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual({ substrate: 'knit', formats: ['pdf_a4_letter', 'pdf_a0'], skills: ['intermediate', 'confident_beginner'] });
  expect(screen.getByRole('button', { name: 'Woven' })).toHaveAttribute('aria-pressed', 'false');
  ['Knit', 'Copyshop A0', 'Intermediate'].forEach(toggle);
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual({ substrate: null, formats: ['pdf_a4_letter'], skills: ['confident_beginner'] });
});

it('uses an exact measurement entered above the slider range and commits it with Enter', () => {
  render(<FilterHarness />);
  const hip = screen.getByRole('spinbutton', { name: 'My full hip in inches' });
  hip.focus();
  fireEvent.change(hip, { target: { value: '72.5' } });
  fireEvent.keyDown(hip, { key: 'Enter' });
  expect(screen.getByRole('slider', { name: 'My full hip' })).toHaveAttribute('aria-valuetext', '72.5 inches');
  expect(JSON.parse(screen.getByTestId('filters').textContent!)).toEqual({ userHipIn: 72.5 });
});

it.each([
  { range: [null, 62], expected: 'Hip up to 62″' },
  { range: [35, null], expected: 'Hip from 35″' },
] as const)('preserves a single reported hip bound ($expected)', ({ range, expected }) => {
  render(<PatternMatchCard card={{ ...card, hipRangeIn: [...range] }} {...attribution} />);
  expect(screen.getByText(expected, { exact: false })).toBeVisible();
});
