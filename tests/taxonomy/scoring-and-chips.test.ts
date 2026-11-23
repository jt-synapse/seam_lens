import { describe, expect, it } from 'vitest';
import {
  ConstructionProfileV1Schema,
  FOCUS_REGIONS,
  type ConstructionProfileV1,
} from '@/modules/taxonomy/construction-profile';
import { computeStructuralScore, combineHybridScore } from '@/modules/taxonomy/scoring';
import { buildExplanationChips } from '@/modules/taxonomy/chips';

const baseDress: ConstructionProfileV1 = {
  schema_version: 1,
  garment_category: 'dress',
  substrate_compatibility: 'woven',
  silhouette: {
    overall_shape: 'fit_and_flare',
    ease_level: 'close_fitting',
    garment_length: 'midi',
  },
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
  closures_and_details: {
    primary_closure: 'invisible_zip_back',
    finish_structure: 'lined_bodice',
  },
  structural_nuance_notes: {
    bodice_neckline: 'Structured square neckline with bust and waist darts',
    sleeves_armscye: 'Elbow-length gathered puff cap sleeves',
    skirt_hemline: 'Gathered rectangle midi skirt with in-seam pockets',
    overall_drape_and_proportions: 'Fitted woven bodice joined to full gathered skirt',
  },
};

const variantSleevelessScoop: ConstructionProfileV1 = {
  ...baseDress,
  bodice_and_neckline: {
    ...baseDress.bodice_and_neckline,
    neckline_type: 'scoop',
  },
  sleeves_and_armscye: {
    armscye_construction: 'sleeveless_cut_in',
    sleeve_style: 'none_sleeveless',
    sleeve_length: 'sleeveless',
    cuff_finish: 'none_hemmed',
  },
};

const baseTop: ConstructionProfileV1 = {
  schema_version: 1,
  garment_category: 'top',
  substrate_compatibility: 'woven',
  silhouette: {
    overall_shape: 'shirt_dress_blouse',
    ease_level: 'semi_fitted',
    garment_length: 'hip_length',
  },
  bodice_and_neckline: {
    neckline_type: 'collared_shirt',
    neckline_depth: 'modest_mid',
    collar_type: 'classic_point',
    shaping_darts_seams: ['bust_dart'],
    waist_definition: 'no_waist_seam_continuous',
    back_detail: 'closed_solid',
  },
  sleeves_and_armscye: {
    armscye_construction: 'set_in',
    sleeve_style: 'bishop',
    sleeve_length: 'wrist_long',
    cuff_finish: 'buttoned_placket_cuff',
  },
  skirt_and_hemline: {
    has_skirt_section: false,
    skirt_construction: 'none_top_hem',
    tier_count: 0,
    slit_detail: 'side_slit',
    hemline_shape: 'curved_shirt_tail',
    pockets: ['none_visible'],
  },
  closures_and_details: {
    primary_closure: 'button_front_full',
    finish_structure: 'unlined_faced',
  },
  structural_nuance_notes: {
    bodice_neckline: 'Classic pointed shirt collar with front button placket',
    sleeves_armscye: 'Long bishop sleeves gathered into buttoned cuffs',
    skirt_hemline: '',
    overall_drape_and_proportions: 'Relaxed hip-length woven blouse with curved hem',
  },
};

describe('Deterministic regional structural scoring & chips', () => {
  it('retains the substrate and closure weights for top silhouette scoring', () => {
    const differentMaterialsAndClosure: ConstructionProfileV1 = {
      ...baseTop,
      substrate_compatibility: 'knit',
      closures_and_details: { ...baseTop.closures_and_details, primary_closure: 'pullover_no_closure' },
    };
    expect(computeStructuralScore(baseTop, differentMaterialsAndClosure, 'full_silhouette')).toBeCloseTo(0.9);
  });

  it('validates all test fixtures cleanly against ConstructionProfileV1Schema', () => {
    expect(ConstructionProfileV1Schema.safeParse(baseDress).success).toBe(true);
    expect(ConstructionProfileV1Schema.safeParse(variantSleevelessScoop).success).toBe(true);
    expect(ConstructionProfileV1Schema.safeParse(baseTop).success).toBe(true);
  });

  it('scores identical profiles as 1.0 across all focus regions and combines with alpha=0.55', () => {
    for (const region of FOCUS_REGIONS) {
      expect(computeStructuralScore(baseDress, baseDress, region)).toBeCloseTo(1.0, 5);
      expect(computeStructuralScore(baseTop, baseTop, region)).toBeCloseTo(1.0, 5);
    }

    expect(combineHybridScore(0.9, 0.8)).toBeCloseTo(0.55 * 0.9 + 0.45 * 0.8, 5);
    expect(combineHybridScore(0.9, 0.8, 0.7)).toBeCloseTo(0.7 * 0.9 + 0.3 * 0.8, 5);
    expect(combineHybridScore(-0.4, 0.0)).toBe(0);
    expect(combineHybridScore(1.5, 1.5)).toBe(1);
  });

  it('weights skirt_hemline at 0.85+0.15 so matching skirt scores >0.90 under skirt_hemline despite sleeve/neck mismatch', () => {
    const skirtFocusScore = computeStructuralScore(baseDress, variantSleevelessScoop, 'skirt_hemline');
    const sleeveFocusScore = computeStructuralScore(baseDress, variantSleevelessScoop, 'sleeves_armscye');
    expect(skirtFocusScore).toBeGreaterThan(0.9);
    expect(sleeveFocusScore).toBeLessThan(0.25);
  });

  it('applies exact regional sub-weights for bodice_neckline, sleeves_armscye, and skirt_hemline', () => {
    const differentNeckOnly: ConstructionProfileV1 = {
      ...baseDress,
      bodice_and_neckline: { ...baseDress.bodice_and_neckline, neckline_type: 'v_neck' },
    };
    expect(computeStructuralScore(baseDress, differentNeckOnly, 'bodice_neckline')).toBeCloseTo(0.65, 5);

    const differentCuffOnly: ConstructionProfileV1 = {
      ...baseDress,
      sleeves_and_armscye: { ...baseDress.sleeves_and_armscye, cuff_finish: 'band_cuff' },
    };
    expect(computeStructuralScore(baseDress, differentCuffOnly, 'sleeves_armscye')).toBeCloseTo(0.88, 5);

    const differentTierOnly: ConstructionProfileV1 = {
      ...baseDress,
      skirt_and_hemline: { ...baseDress.skirt_and_hemline, tier_count: 2 },
    };
    expect(computeStructuralScore(baseDress, differentTierOnly, 'skirt_hemline')).toBeCloseTo(0.85, 5);
  });

  it('treats "both" substrate as compatible (1.0) with woven or knit while penalizing woven vs knit', () => {
    const bothDress: ConstructionProfileV1 = { ...baseDress, substrate_compatibility: 'both' };
    const knitDress: ConstructionProfileV1 = { ...baseDress, substrate_compatibility: 'knit' };

    expect(computeStructuralScore(baseDress, bothDress, 'sleeves_armscye')).toBeCloseTo(1.0, 5);
    expect(computeStructuralScore(knitDress, bothDress, 'sleeves_armscye')).toBeCloseTo(1.0, 5);
    expect(computeStructuralScore(baseDress, knitDress, 'sleeves_armscye')).toBeCloseTo(0.85, 5);
    expect(computeStructuralScore(baseDress, knitDress, 'bodice_neckline')).toBeCloseTo(0.925, 5);
    expect(computeStructuralScore(baseDress, knitDress, 'skirt_hemline')).toBeCloseTo(0.925, 5);
  });

  it('computes Jaccard similarity for shaping_darts_seams and pockets, including partial overlap and empty arrays', () => {
    const singleDartDress: ConstructionProfileV1 = {
      ...baseDress,
      bodice_and_neckline: {
        ...baseDress.bodice_and_neckline,
        shaping_darts_seams: ['bust_dart'],
      },
    };
    // Jaccard(['bust_dart', 'waist_dart'], ['bust_dart']) = 0.5 -> loses 0.5 * 0.20 = 0.10 in bodice_neckline
    expect(computeStructuralScore(baseDress, singleDartDress, 'bodice_neckline')).toBeCloseTo(0.9, 5);

    const twoPocketDress: ConstructionProfileV1 = {
      ...baseDress,
      skirt_and_hemline: {
        ...baseDress.skirt_and_hemline,
        pockets: ['in_seam', 'patch'],
      },
    };
    // Jaccard(['in_seam'], ['in_seam', 'patch']) = 0.5 -> loses 0.5 * 0.08 = 0.04 in skirt_hemline
    expect(computeStructuralScore(baseDress, twoPocketDress, 'skirt_hemline')).toBeCloseTo(0.96, 5);

    const emptyDartsA: ConstructionProfileV1 = {
      ...baseDress,
      bodice_and_neckline: { ...baseDress.bodice_and_neckline, shaping_darts_seams: [] },
    };
    const emptyDartsB: ConstructionProfileV1 = {
      ...baseDress,
      bodice_and_neckline: { ...baseDress.bodice_and_neckline, shaping_darts_seams: [] },
    };
    expect(computeStructuralScore(emptyDartsA, emptyDartsB, 'bodice_neckline')).toBeCloseTo(1.0, 5);
    expect(computeStructuralScore(baseDress, emptyDartsA, 'bodice_neckline')).toBeCloseTo(0.8, 5);
  });

  it('redistributes the 0.20 skirt weight proportionally when query garment_category is top under full_silhouette', () => {
    expect(computeStructuralScore(baseTop, baseTop, 'full_silhouette')).toBeCloseTo(1.0, 5);

    const boxyTop: ConstructionProfileV1 = {
      ...baseTop,
      silhouette: { ...baseTop.silhouette, overall_shape: 'boxy_cropped' },
    };
    // The shape penalty scales with the geometry weights receiving the skirt share.
    expect(computeStructuralScore(baseTop, boxyTop, 'full_silhouette')).toBeCloseTo(1 - 0.20 * (0.90 / 0.70), 5);
  });

  it('emits up to 4 Matched chips and up to 2 Diff/Minor Hack chips when totalScore >= 0.62', () => {
    const { matched, diffs } = buildExplanationChips(baseDress, variantSleevelessScoop, 'full_silhouette', 0.74);
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThanOrEqual(4);
    expect(matched.every((c) => c.kind === 'matched')).toBe(true);
    expect(diffs.length).toBe(2);
    expect(diffs.every((c) => c.kind === 'diff')).toBe(true);
    expect(diffs.map((d) => d.slot)).toEqual(expect.arrayContaining(['neckline_type', 'sleeve_style']));
    expect(diffs.find((d) => d.slot === 'sleeve_style')?.label).toBe('Diff: Sleeveless block (add sleeve)');
    expect(diffs.find((d) => d.slot === 'neckline_type')?.label).toBe('Diff: Scoop neckline vs. Square');

    const boundaryChips = buildExplanationChips(baseDress, variantSleevelessScoop, 'full_silhouette', 0.62);
    expect(boundaryChips.diffs).toHaveLength(2);

    const lowScoreChips = buildExplanationChips(baseDress, variantSleevelessScoop, 'full_silhouette', 0.5);
    expect(lowScoreChips.diffs).toHaveLength(0);
    expect(lowScoreChips.matched.length).toBeGreaterThan(0);
  });

  it('prioritizes active-region slots first and handles substrate diffs cleanly', () => {
    const bodiceMatched = buildExplanationChips(baseDress, baseDress, 'bodice_neckline', 0.95).matched;
    expect(bodiceMatched.length).toBeLessThanOrEqual(4);
    expect(bodiceMatched[0]).toEqual({
      kind: 'matched',
      slot: 'neckline_type',
      label: 'Modest Mid Square Neckline',
    });
    expect(bodiceMatched[1]).toEqual({
      kind: 'matched',
      slot: 'shaping_darts_seams',
      label: 'Bust + Waist Darts',
    });

    const sleeveMatched = buildExplanationChips(baseDress, baseDress, 'sleeves_armscye', 0.95).matched;
    expect(sleeveMatched.length).toBeLessThanOrEqual(4);
    expect(sleeveMatched[0]).toEqual({
      kind: 'matched',
      slot: 'sleeve_style',
      label: 'Elbow Puff Sleeve',
    });

    const skirtMatched = buildExplanationChips(baseDress, baseDress, 'skirt_hemline', 0.95).matched;
    expect(skirtMatched.length).toBeLessThanOrEqual(4);
    expect(skirtMatched[0]).toEqual({
      kind: 'matched',
      slot: 'skirt_construction',
      label: 'Gathered Midi Skirt',
    });

    const knitDress: ConstructionProfileV1 = { ...baseDress, substrate_compatibility: 'knit' };
    const bothDress: ConstructionProfileV1 = { ...baseDress, substrate_compatibility: 'both' };

    const incompatibleChips = buildExplanationChips(baseDress, knitDress, 'bodice_neckline', 0.8);
    expect(incompatibleChips.diffs).toEqual([
      { kind: 'diff', slot: 'substrate_compatibility', label: 'Note: Drafted for Knit' },
    ]);

    const compatibleBothChips = buildExplanationChips(baseDress, bothDress, 'bodice_neckline', 0.9);
    expect(compatibleBothChips.diffs).toHaveLength(0);
  });
});
