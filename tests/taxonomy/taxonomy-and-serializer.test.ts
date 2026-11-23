import { describe, expect, it } from 'vitest';
import {
  ConstructionProfileV1Schema,
  DELIVERY_FORMATS,
  FOCUS_REGIONS,
  GARMENT_CATEGORIES,
  SKILL_LEVELS,
  SUBSTRATE_COMPATIBILITIES,
  type ConstructionProfileV1,
} from '@/modules/taxonomy/construction-profile';
import {
  sanitizeStructuralNote,
  serializeCanonicalRegions,
} from '@/modules/taxonomy/canonical-serializer';
import {
  normalizeMeasurementSpan,
  parseMeasurementInches,
} from '@/modules/taxonomy/measurements';

const sampleDress: ConstructionProfileV1 = {
  schema_version: 1,
  garment_category: 'dress',
  substrate_compatibility: 'woven',
  silhouette: { overall_shape: 'fit_and_flare', ease_level: 'close_fitting', garment_length: 'midi' },
  bodice_and_neckline: {
    neckline_type: 'square',
    neckline_depth: 'modest_mid',
    collar_type: 'none',
    shaping_darts_seams: ['bust_dart', 'waist_dart'],
    waist_definition: 'natural_seam',
    back_detail: 'closed_solid',
  },
  sleeves_and_armscye: {
    armscye_construction: 'set_in',
    sleeve_style: 'puff_gathered_cap',
    sleeve_length: 'elbow',
    cuff_finish: 'elastic_casing',
  },
  skirt_and_hemline: {
    has_skirt_section: true,
    skirt_construction: 'gathered_rectangle',
    tier_count: 1,
    slit_detail: 'none',
    hemline_shape: 'straight_level',
    pockets: ['in_seam'],
  },
  closures_and_details: { primary_closure: 'invisible_zip_back', finish_structure: 'lined_bodice' },
  structural_nuance_notes: {
    bodice_neckline: 'Liberty-floral square bodice with bias-cut facing and collar-stand absence',
    sleeves_armscye: 'GINGHAM-check gathered cap with 2x fullness',
    skirt_hemline: 'Navy/ivory Breton-stripe box-pleat look at side in-seam pockets',
    overall_drape_and_proportions: 'Crisp cotton wash in crimson red with structured waist join',
  },
};

describe('ConstructionProfileV1 & print-blind serialization', () => {
  it('exposes canonical v1 enum constants matching Spec §5.2', () => {
    expect(FOCUS_REGIONS).toEqual([
      'full_silhouette',
      'bodice_neckline',
      'sleeves_armscye',
      'skirt_hemline',
    ]);
    expect(GARMENT_CATEGORIES).toEqual(['dress', 'top']);
    expect(SUBSTRATE_COMPATIBILITIES).toEqual(['woven', 'knit', 'both']);
    expect(DELIVERY_FORMATS).toEqual(['pdf_a4_letter', 'pdf_a0', 'projector', 'paper_envelope']);
    expect(SKILL_LEVELS).toEqual(['confident_beginner', 'intermediate', 'advanced_couture']);
  });

  it('validates canonical dress profile and rejects unknown enum values or overlong notes', () => {
    expect(ConstructionProfileV1Schema.safeParse(sampleDress).success).toBe(true);
    expect(
      ConstructionProfileV1Schema.safeParse({ ...sampleDress, garment_category: 'trousers' }).success
    ).toBe(false);
    expect(
      ConstructionProfileV1Schema.safeParse({
        ...sampleDress,
        skirt_and_hemline: { ...sampleDress.skirt_and_hemline, tier_count: 4 },
      }).success
    ).toBe(false);
    expect(
      ConstructionProfileV1Schema.safeParse({
        ...sampleDress,
        structural_nuance_notes: {
          ...sampleDress.structural_nuance_notes,
          bodice_neckline: 'a'.repeat(301),
        },
      }).success
    ).toBe(false);
  });

  it('scrubs compound/uppercase print & color words while preserving sewing terms (Review Focus #2)', () => {
    const cleaned = sanitizeStructuralNote(
      'Liberty-floral GINGHAM-check navy/ivory Breton-stripe crimson bias-cut box-pleat collar-stand'
    );
    expect(cleaned.toLowerCase()).not.toMatch(/floral|gingham|navy|ivory|stripe|crimson/);
    expect(cleaned).toContain('bias-cut');
    expect(cleaned).toContain('box-pleat');
    expect(cleaned).toContain('collar-stand');

    const extraCleaned = sanitizeStructuralNote(
      'Acid-wash terracotta/emerald polka-dot plaid gathered tiered fitted set-in a-line in-seam high-low'
    );
    expect(extraCleaned.toLowerCase()).not.toMatch(/acid-wash|terracotta|emerald|polka|plaid/);
    expect(extraCleaned).toContain('gathered');
    expect(extraCleaned).toContain('tiered');
    expect(extraCleaned).toContain('fitted');
    expect(extraCleaned).toContain('set-in');
    expect(extraCleaned).toContain('a-line');
    expect(extraCleaned).toContain('in-seam');
    expect(extraCleaned).toContain('high-low');
  });

  it('emits 4 region strings for dresses and null skirt_hemline when has_skirt_section is false', () => {
    const dressTexts = serializeCanonicalRegions(sampleDress);
    expect(dressTexts.skirt_hemline).toContain('gathered_rectangle');
    expect(dressTexts.full_silhouette.toLowerCase()).not.toMatch(/floral|gingham|crimson/);
    expect(dressTexts.bodice_neckline).toContain('square');
    expect(dressTexts.bodice_neckline).toContain('bias-cut');
    expect(dressTexts.sleeves_armscye).toContain('puff_gathered_cap');
    expect(dressTexts.skirt_hemline).toContain('box-pleat');
    expect(dressTexts.skirt_hemline?.toLowerCase()).not.toMatch(/navy|ivory|breton|stripe/);

    const topProfile: ConstructionProfileV1 = {
      ...sampleDress,
      garment_category: 'top',
      skirt_and_hemline: {
        ...sampleDress.skirt_and_hemline,
        has_skirt_section: false,
        skirt_construction: 'none_top_hem',
        tier_count: 0,
      },
    };
    const topTexts = serializeCanonicalRegions(topProfile);
    expect(topTexts.skirt_hemline).toBeNull();
    expect(topTexts.full_silhouette).toContain('top');
  });

  it('parses decimal inches, unicode/slash fractions, and converts cm to inches (Review Focus #3)', () => {
    expect(parseMeasurementInches('44')).toBe(44);
    expect(parseMeasurementInches('33½"')).toBe(33.5);
    expect(parseMeasurementInches('34 1/4 in')).toBe(34.3);
    expect(parseMeasurementInches('101.6 cm')).toBe(40.0);
    expect(parseMeasurementInches(112, 'cm')).toBe(44.1);
    expect(parseMeasurementInches('')).toBeNull();

    expect(parseMeasurementInches(null)).toBeNull();
    expect(parseMeasurementInches(undefined)).toBeNull();
    expect(parseMeasurementInches('unknown')).toBeNull();
    expect(parseMeasurementInches('81 cm')).toBe(31.9);
    expect(parseMeasurementInches('34 3/4"')).toBe(34.8);
    expect(parseMeasurementInches('1/2 in')).toBe(0.5);
    expect(parseMeasurementInches('40 in', 'cm')).toBe(40);
  });

  it('normalizes measurement spans and throws on invalid or inverted bounds', () => {
    expect(normalizeMeasurementSpan('81', '142', 'cm')).toEqual({ minIn: 31.9, maxIn: 55.9 });
    expect(normalizeMeasurementSpan('33½"', '48 1/4 in')).toEqual({ minIn: 33.5, maxIn: 48.3 });
    expect(() => normalizeMeasurementSpan('', '40')).toThrow();
    expect(() => normalizeMeasurementSpan('32', 'n/a')).toThrow();
    expect(() => normalizeMeasurementSpan('44', '38')).toThrow();
  });
});
