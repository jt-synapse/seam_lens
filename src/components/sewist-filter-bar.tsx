'use client';

import { useId, useState } from 'react';
import type { SearchFilters } from '@/modules/search/hybrid-ranker';
import type { DeliveryFormat, SkillLevel } from '@/modules/taxonomy/construction-profile';
import './sewist-filters.css';

export const formatLabels: Record<DeliveryFormat, string> = {
  pdf_a4_letter: 'PDF A4/Letter', pdf_a0: 'Copyshop A0', projector: 'Projector', paper_envelope: 'Paper',
};
export const skillLabels: Record<SkillLevel, string> = {
  confident_beginner: 'Confident beginner', intermediate: 'Intermediate', advanced_couture: 'Advanced / Couture',
};

function Measurement({ label, max, value, onChange }: {
  label: string; max: number; value?: number | null; onChange: (value: number | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  // One unfiltered stop before 32 makes the lowest measurement reachable from Any.
  const anyStop = 31.9;
  return (
    <fieldset className="sewist-measure">
      <legend id={`${id}-label`}>{label}</legend>
      <div className="sewist-measure-readout">
        <label className="sewist-number">
          <input type="number" aria-label={`${label} in inches`} min={32} step="0.1" inputMode="decimal"
            placeholder="Any" value={draft ?? value ?? ''}
            onChange={event => setDraft(event.currentTarget.value)}
            onBlur={event => {
              const input = event.currentTarget;
              if (draft !== null && input.validity.valid) {
                const next = input.value === '' ? null : input.valueAsNumber;
                if (next !== (value ?? null)) onChange(next);
              }
              setDraft(null);
            }}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <span aria-hidden="true">in</span>
        </label>
        <button type="button" className="sewist-reset" aria-label={`Set ${label.toLowerCase()} to Any`}
          onClick={() => onChange(null)}>Any</button>
      </div>
      <input className="sewist-track" type="range" min={anyStop} max={Math.max(max, value ?? max)} step="0.1"
        aria-labelledby={`${id}-label`} aria-describedby={`${id}-range`}
        aria-valuetext={value == null ? 'Any' : `${value} inches`} value={value ?? anyStop}
        onChange={event => {
          const inches = event.currentTarget.valueAsNumber;
          onChange(inches === anyStop ? null : inches);
        }} />
      <div className="sewist-endpoints" id={`${id}-range`}><span>32″</span><span>{Math.max(max, value ?? max)}″+</span></div>
    </fieldset>
  );
}

function MultipleChoices<T extends string>({ legend, labels, selected, onChange }: {
  legend: string; labels: Record<T, string>; selected: T[]; onChange: (selected: T[]) => void;
}) {
  return (
    <fieldset className="sewist-choices">
      <legend>{legend}</legend>
      <div className="sewist-pills">{(Object.keys(labels) as T[]).map(value => (
        <button key={value} type="button" aria-pressed={selected.includes(value)}
          onClick={() => onChange(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value])}>
          {labels[value]}
        </button>
      ))}</div>
    </fieldset>
  );
}

export function SewistFilterBar({ filters, onChange }: { filters: SearchFilters; onChange: (next: SearchFilters) => void }) {
  return (
    <section className="sewist-filters" aria-label="Sewist filters">
      <fieldset className="sewist-choices">
        <legend>Fabric</legend>
        <div className="sewist-pills">{(['woven', 'knit'] as const).map(substrate => (
          <button type="button" key={substrate} aria-pressed={filters.substrate === substrate}
            onClick={() => onChange({ ...filters, substrate: filters.substrate === substrate ? null : substrate })}>
            {substrate === 'woven' ? 'Woven' : 'Knit'}
          </button>
        ))}</div>
      </fieldset>
      <Measurement label="My full bust" value={filters.userBustIn} max={64}
        onChange={userBustIn => onChange({ ...filters, userBustIn })} />
      <Measurement label="My full hip" value={filters.userHipIn} max={68}
        onChange={userHipIn => onChange({ ...filters, userHipIn })} />
      <MultipleChoices legend="Format" labels={formatLabels} selected={filters.formats ?? []}
        onChange={formats => onChange({ ...filters, formats })} />
      <MultipleChoices legend="Skill level" labels={skillLabels} selected={filters.skills ?? []}
        onChange={skills => onChange({ ...filters, skills })} />
    </section>
  );
}
