import type {
  ARMSCYE_CONSTRUCTIONS,
  COLLAR_TYPES,
  ConstructionProfileV1,
  CUFF_FINISHES,
  EASE_LEVELS,
  FocusRegion,
  GARMENT_LENGTHS,
  HEMLINE_SHAPES,
  NECKLINE_DEPTHS,
  NECKLINE_TYPES,
  OVERALL_SHAPES,
  POCKET_TYPES,
  PRIMARY_CLOSURES,
  SHAPING_DARTS_SEAMS,
  SKIRT_CONSTRUCTIONS,
  SLEEVE_LENGTHS,
  SLEEVE_STYLES,
  SLIT_DETAILS,
  SubstrateCompatibility,
  WAIST_DEFINITIONS,
} from './construction-profile';
import { isSubstrateCompatible } from './scoring';

export interface MatchChip {
  kind: 'matched' | 'diff';
  slot: string;
  label: string;
}

const MAX_MATCHED_CHIPS = 4;
const MAX_DIFF_CHIPS = 2;
const DIFF_SCORE_THRESHOLD = 0.62;

type OverallShape = (typeof OVERALL_SHAPES)[number];
type EaseLevel = (typeof EASE_LEVELS)[number];
type GarmentLength = (typeof GARMENT_LENGTHS)[number];
type NecklineType = (typeof NECKLINE_TYPES)[number];
type NecklineDepth = (typeof NECKLINE_DEPTHS)[number];
type CollarType = (typeof COLLAR_TYPES)[number];
type ShapingDartSeam = (typeof SHAPING_DARTS_SEAMS)[number];
type WaistDefinition = (typeof WAIST_DEFINITIONS)[number];
type ArmscyeConstruction = (typeof ARMSCYE_CONSTRUCTIONS)[number];
type SleeveStyle = (typeof SLEEVE_STYLES)[number];
type SleeveLength = (typeof SLEEVE_LENGTHS)[number];
type CuffFinish = (typeof CUFF_FINISHES)[number];
type SkirtConstruction = (typeof SKIRT_CONSTRUCTIONS)[number];
type SlitDetail = (typeof SLIT_DETAILS)[number];
type HemlineShape = (typeof HEMLINE_SHAPES)[number];
type PocketType = (typeof POCKET_TYPES)[number];
type PrimaryClosure = (typeof PRIMARY_CLOSURES)[number];

const OVERALL_SHAPE_LABELS: Record<OverallShape, string> = {
  a_line: 'A-Line',
  fit_and_flare: 'Fit-and-Flare',
  empire: 'Empire',
  shift_column: 'Shift / Column',
  sheath_fitted: 'Sheath Fitted',
  tiered_smock: 'Tiered Smock',
  wrap: 'Wrap',
  shirt_dress_blouse: 'Shirt-Dress / Blouse',
  bias_slip: 'Bias Slip',
  peplum: 'Peplum',
  boxy_cropped: 'Boxy Cropped',
  trapeze_tent: 'Trapeze / Tent',
};

const EASE_LEVEL_LABELS: Record<EaseLevel, string> = {
  negative_ease: 'Negative Ease',
  close_fitting: 'Close-Fitting',
  semi_fitted: 'Semi-Fitted',
  relaxed: 'Relaxed Ease',
  oversized: 'Oversized',
};

const GARMENT_LENGTH_LABELS: Record<GarmentLength, string> = {
  cropped: 'Cropped',
  hip_length: 'Hip-Length',
  tunic: 'Tunic',
  mini: 'Mini',
  knee: 'Knee-Length',
  midi: 'Midi',
  maxi: 'Maxi',
};

const NECKLINE_TYPE_LABELS: Record<NecklineType, string> = {
  crew_round: 'Crew / Round',
  scoop: 'Scoop',
  v_neck: 'V-Neck',
  surplice_wrap: 'Surplice Wrap',
  square: 'Square',
  sweetheart: 'Sweetheart',
  boat_bateau: 'Boat / Bateau',
  cowl: 'Cowl',
  halter: 'Halter',
  collared_shirt: 'Collared Shirt',
  mandarin_band: 'Mandarin Band',
  tie_neck_bow: 'Tie-Neck Bow',
  off_shoulder: 'Off-Shoulder',
  one_shoulder: 'One-Shoulder',
  high_mock_turtleneck: 'High Mock / Turtleneck',
  keyhole: 'Keyhole',
};

const NECKLINE_DEPTH_LABELS: Record<NecklineDepth, string> = {
  high: 'High',
  modest_mid: 'Modest Mid',
  deep_plunging: 'Deep Plunging',
};

const COLLAR_TYPE_LABELS: Record<CollarType, string> = {
  none: 'No Collar',
  classic_point: 'Classic Point Collar',
  peter_pan: 'Peter Pan Collar',
  camp_revere: 'Camp / Revere Collar',
  band_stand: 'Band / Stand Collar',
  shawl: 'Shawl Collar',
  ruffle_frill: 'Ruffle / Frill Collar',
};

const SHAPING_LABELS: Record<ShapingDartSeam, string> = {
  bust_dart: 'Bust Dart',
  waist_dart: 'Waist Dart',
  french_dart: 'French Dart',
  princess_seam_shoulder: 'Shoulder Princess Seams',
  princess_seam_armscye: 'Armscye Princess Seams',
  shirring_elastic: 'Elastic Shirring',
  gathers_yoke: 'Yoke Gathers',
  tucks_pleats: 'Tucks & Pleats',
  boning_corsetry: 'Boning / Corsetry',
  bias_drape: 'Bias Drape',
  none_cut_straight: 'Unshaped Straight Cut',
};

const WAIST_DEFINITION_LABELS: Record<WaistDefinition, string> = {
  natural_seam: 'Natural Waist Seam',
  empire_seam: 'Empire Waist Seam',
  dropped_waist_seam: 'Dropped Waist Seam',
  no_waist_seam_continuous: 'Continuous Waist',
  cinched_tie_belt: 'Cinched Tie Belt',
  elasticated_waist: 'Elasticated Waist',
};

const ARMSCYE_LABELS: Record<ArmscyeConstruction, string> = {
  set_in: 'Set-In Armscye',
  dropped_shoulder: 'Dropped Shoulder',
  raglan: 'Raglan Sleeve',
  dolman_grown_on: 'Dolman / Grown-On',
  yoke_sleeve: 'Yoke Armscye',
  sleeveless_straps: 'Sleeveless Straps',
  sleeveless_cut_in: 'Sleeveless Cut-In',
};

const SLEEVE_STYLE_LABELS: Record<SleeveStyle, string> = {
  none_sleeveless: 'Sleeveless',
  spaghetti_camisole: 'Spaghetti Strap',
  wide_strap: 'Wide Strap',
  cap: 'Cap Sleeve',
  fitted_straight: 'Fitted Straight Sleeve',
  puff_gathered_cap: 'Puff Sleeve',
  puff_gathered_hem: 'Gathered-Hem Puff Sleeve',
  puff_full_lantern: 'Full Lantern Puff Sleeve',
  bishop: 'Bishop Sleeve',
  flutter_bell: 'Flutter / Bell Sleeve',
  fluted_flare: 'Fluted Flare Sleeve',
  kimono_wide: 'Wide Kimono Sleeve',
};

const SLEEVE_LENGTH_LABELS: Record<SleeveLength, string> = {
  sleeveless: 'Sleeveless',
  cap: 'Cap',
  short: 'Short',
  elbow: 'Elbow',
  three_quarter: '3/4',
  wrist_long: 'Long',
};

const CUFF_FINISH_LABELS: Record<CuffFinish, string> = {
  none_hemmed: 'Plain Hemmed Cuff',
  elastic_casing: 'Elastic Cuff Casing',
  buttoned_placket_cuff: 'Buttoned Placket Cuff',
  band_cuff: 'Band Cuff',
  tie_cuff: 'Tie Cuff',
  bias_bound: 'Bias-Bound Cuff',
};

const SKIRT_CONSTRUCTION_LABELS: Record<SkirtConstruction, string> = {
  none_top_hem: 'Top Hem',
  gathered_rectangle: 'Gathered',
  tiered_gathered: 'Tiered Gathered',
  a_line_panel: 'A-Line',
  gored_panels: 'Gored Panel',
  circle_half_full: 'Circle',
  bias_cut: 'Bias-Cut',
  wrap_overlap: 'Wrap',
  pleated_box_knife: 'Pleated',
  pencil_straight: 'Pencil Straight',
  tulip_draped: 'Tulip Draped',
};

const SLIT_DETAIL_LABELS: Record<SlitDetail, string> = {
  none: 'No Slit',
  side_slit: 'Side Slit',
  front_slit: 'Front Slit',
  back_vent: 'Back Vent',
  wrap_opening: 'Wrap Opening',
};

const HEMLINE_SHAPE_LABELS: Record<HemlineShape, string> = {
  straight_level: 'Straight Level Hem',
  curved_shirt_tail: 'Curved Shirttail Hem',
  high_low: 'High-Low Hem',
  asymmetric: 'Asymmetric Hem',
  ruffle_flounce: 'Ruffle / Flounce Hem',
};

const POCKET_TYPE_LABELS: Record<PocketType, string> = {
  none_visible: 'No Visible Pockets',
  in_seam: 'In-Seam Pockets',
  patch: 'Patch Pockets',
  slash_welt: 'Slash / Welt Pockets',
};

const PRIMARY_CLOSURE_LABELS: Record<PrimaryClosure, string> = {
  pullover_no_closure: 'Pullover (No Closure)',
  invisible_zip_back: 'Invisible Back Zip',
  invisible_zip_side: 'Invisible Side Zip',
  exposed_zip: 'Exposed Zip',
  button_front_full: 'Full Button Front',
  button_front_partial_placket: 'Partial Button Placket',
  button_back: 'Button Back',
  wrap_tie: 'Wrap Tie Closure',
  hook_keyhole: 'Hook & Keyhole',
  shirred_stretch: 'Shirred Stretch Bodice',
};

const SUBSTRATE_LABELS: Record<SubstrateCompatibility, string> = {
  woven: 'Woven',
  knit: 'Knit',
  both: 'Woven & Knit',
};

type ChipSlot =
  | 'overall_shape'
  | 'ease_level'
  | 'garment_length'
  | 'neckline_type'
  | 'collar_type'
  | 'shaping_darts_seams'
  | 'waist_definition'
  | 'sleeve_style'
  | 'armscye_construction'
  | 'sleeve_length'
  | 'cuff_finish'
  | 'skirt_construction'
  | 'tier_count'
  | 'slit_detail'
  | 'hemline_shape'
  | 'pockets'
  | 'substrate_compatibility'
  | 'primary_closure';

interface SlotEvaluation {
  matchedLabel?: string;
  diffLabel?: string;
}

const MATCHED_SLOT_PRIORITY: Record<FocusRegion, readonly ChipSlot[]> = {
  full_silhouette: [
    'neckline_type',
    'shaping_darts_seams',
    'sleeve_style',
    'skirt_construction',
    'overall_shape',
    'waist_definition',
    'garment_length',
    'substrate_compatibility',
    'primary_closure',
  ],
  bodice_neckline: [
    'neckline_type',
    'shaping_darts_seams',
    'waist_definition',
    'collar_type',
    'ease_level',
    'substrate_compatibility',
  ],
  sleeves_armscye: [
    'sleeve_style',
    'armscye_construction',
    'sleeve_length',
    'cuff_finish',
    'substrate_compatibility',
  ],
  skirt_hemline: [
    'skirt_construction',
    'tier_count',
    'garment_length',
    'waist_definition',
    'pockets',
    'slit_detail',
    'hemline_shape',
    'substrate_compatibility',
  ],
};

const DIFF_SLOT_PRIORITY: Record<FocusRegion, readonly ChipSlot[]> = {
  full_silhouette: [
    'neckline_type',
    'sleeve_style',
    'skirt_construction',
    'overall_shape',
    'substrate_compatibility',
    'waist_definition',
    'shaping_darts_seams',
    'garment_length',
    'primary_closure',
  ],
  bodice_neckline: [
    'neckline_type',
    'shaping_darts_seams',
    'waist_definition',
    'collar_type',
    'substrate_compatibility',
    'ease_level',
  ],
  sleeves_armscye: [
    'sleeve_style',
    'armscye_construction',
    'sleeve_length',
    'cuff_finish',
    'substrate_compatibility',
  ],
  skirt_hemline: [
    'skirt_construction',
    'garment_length',
    'tier_count',
    'waist_definition',
    'substrate_compatibility',
    'hemline_shape',
    'slit_detail',
    'pockets',
  ],
};

function formatShapingList(items: readonly ShapingDartSeam[]): string {
  if (items.length === 0) return 'Unshaped';
  const unique = Array.from(new Set(items));
  if (unique.length === 2 && unique.includes('bust_dart') && unique.includes('waist_dart')) {
    return 'Bust + Waist Darts';
  }
  return unique.map((item) => SHAPING_LABELS[item]).join(' + ');
}

function evaluateSlot(
  slot: ChipSlot,
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): SlotEvaluation {
  switch (slot) {
    case 'neckline_type': {
      const qNeck = query.bodice_and_neckline.neckline_type;
      const cNeck = candidate.bodice_and_neckline.neckline_type;
      if (qNeck === cNeck) {
        const sameDepth =
          query.bodice_and_neckline.neckline_depth === candidate.bodice_and_neckline.neckline_depth;
        return {
          matchedLabel: sameDepth
            ? `${NECKLINE_DEPTH_LABELS[query.bodice_and_neckline.neckline_depth]} ${NECKLINE_TYPE_LABELS[qNeck]} Neckline`
            : `${NECKLINE_TYPE_LABELS[qNeck]} Neckline`,
        };
      }
      return {
        diffLabel: `Diff: ${NECKLINE_TYPE_LABELS[cNeck]} neckline vs. ${NECKLINE_TYPE_LABELS[qNeck]}`,
      };
    }

    case 'collar_type': {
      const qCollar = query.bodice_and_neckline.collar_type;
      const cCollar = candidate.bodice_and_neckline.collar_type;
      if (qCollar === cCollar) {
        return qCollar !== 'none' ? { matchedLabel: COLLAR_TYPE_LABELS[qCollar] } : {};
      }
      return {
        diffLabel: `Diff: ${COLLAR_TYPE_LABELS[cCollar]} vs. ${COLLAR_TYPE_LABELS[qCollar]}`,
      };
    }

    case 'shaping_darts_seams': {
      const qShaping = query.bodice_and_neckline.shaping_darts_seams;
      const cShaping = candidate.bodice_and_neckline.shaping_darts_seams;
      const cSet = new Set(cShaping);
      const shared = qShaping.filter((item) => cSet.has(item));
      if (shared.length > 0) {
        return { matchedLabel: formatShapingList(shared) };
      }
      if (qShaping.length > 0 || cShaping.length > 0) {
        return {
          diffLabel: `Diff: ${formatShapingList(cShaping)} vs. ${formatShapingList(qShaping)}`,
        };
      }
      return {};
    }

    case 'waist_definition': {
      const qWaist = query.bodice_and_neckline.waist_definition;
      const cWaist = candidate.bodice_and_neckline.waist_definition;
      return qWaist === cWaist
        ? { matchedLabel: WAIST_DEFINITION_LABELS[qWaist] }
        : {
            diffLabel: `Diff: ${WAIST_DEFINITION_LABELS[cWaist]} vs. ${WAIST_DEFINITION_LABELS[qWaist]}`,
          };
    }

    case 'ease_level': {
      const qEase = query.silhouette.ease_level;
      const cEase = candidate.silhouette.ease_level;
      return qEase === cEase
        ? { matchedLabel: `${EASE_LEVEL_LABELS[qEase]} Bodice` }
        : { diffLabel: `Diff: ${EASE_LEVEL_LABELS[cEase]} vs. ${EASE_LEVEL_LABELS[qEase]}` };
    }

    case 'sleeve_style': {
      const qStyle = query.sleeves_and_armscye.sleeve_style;
      const cStyle = candidate.sleeves_and_armscye.sleeve_style;
      if (qStyle === cStyle) {
        if (qStyle === 'none_sleeveless') {
          return { matchedLabel: 'Sleeveless Block' };
        }
        const qLen = query.sleeves_and_armscye.sleeve_length;
        const cLen = candidate.sleeves_and_armscye.sleeve_length;
        const includeLength = qLen === cLen && qLen !== 'sleeveless' && qLen !== 'cap';
        return {
          matchedLabel: includeLength
            ? `${SLEEVE_LENGTH_LABELS[qLen]} ${SLEEVE_STYLE_LABELS[qStyle]}`
            : SLEEVE_STYLE_LABELS[qStyle],
        };
      }
      if (cStyle === 'none_sleeveless' && qStyle !== 'none_sleeveless') {
        return { diffLabel: 'Diff: Sleeveless block (add sleeve)' };
      }
      return {
        diffLabel: `Diff: ${SLEEVE_STYLE_LABELS[cStyle]} vs. ${SLEEVE_STYLE_LABELS[qStyle]}`,
      };
    }

    case 'armscye_construction': {
      const qArmscye = query.sleeves_and_armscye.armscye_construction;
      const cArmscye = candidate.sleeves_and_armscye.armscye_construction;
      return qArmscye === cArmscye
        ? { matchedLabel: ARMSCYE_LABELS[qArmscye] }
        : { diffLabel: `Diff: ${ARMSCYE_LABELS[cArmscye]} vs. ${ARMSCYE_LABELS[qArmscye]}` };
    }

    case 'sleeve_length': {
      const qLen = query.sleeves_and_armscye.sleeve_length;
      const cLen = candidate.sleeves_and_armscye.sleeve_length;
      return qLen === cLen
        ? { matchedLabel: `${SLEEVE_LENGTH_LABELS[qLen]} Sleeve Length` }
        : {
            diffLabel: `Diff: ${SLEEVE_LENGTH_LABELS[cLen]} sleeve vs. ${SLEEVE_LENGTH_LABELS[qLen]}`,
          };
    }

    case 'cuff_finish': {
      const qCuff = query.sleeves_and_armscye.cuff_finish;
      const cCuff = candidate.sleeves_and_armscye.cuff_finish;
      if (qCuff === cCuff) {
        return qCuff !== 'none_hemmed' ? { matchedLabel: CUFF_FINISH_LABELS[qCuff] } : {};
      }
      return {
        diffLabel: `Diff: ${CUFF_FINISH_LABELS[cCuff]} vs. ${CUFF_FINISH_LABELS[qCuff]}`,
      };
    }

    case 'skirt_construction': {
      if (!query.skirt_and_hemline.has_skirt_section && !candidate.skirt_and_hemline.has_skirt_section) {
        return {};
      }
      if (query.skirt_and_hemline.has_skirt_section !== candidate.skirt_and_hemline.has_skirt_section) {
        return {
          diffLabel: candidate.skirt_and_hemline.has_skirt_section
            ? 'Diff: Includes skirt section vs. Top block'
            : 'Diff: Top block (no skirt section)',
        };
      }
      const qSkirt = query.skirt_and_hemline.skirt_construction;
      const cSkirt = candidate.skirt_and_hemline.skirt_construction;
      if (qSkirt === cSkirt) {
        const sameLen = query.silhouette.garment_length === candidate.silhouette.garment_length;
        return {
          matchedLabel: sameLen
            ? `${SKIRT_CONSTRUCTION_LABELS[qSkirt]} ${GARMENT_LENGTH_LABELS[query.silhouette.garment_length]} Skirt`
            : `${SKIRT_CONSTRUCTION_LABELS[qSkirt]} Skirt`,
        };
      }
      return {
        diffLabel: `Diff: ${SKIRT_CONSTRUCTION_LABELS[cSkirt]} skirt vs. ${SKIRT_CONSTRUCTION_LABELS[qSkirt]}`,
      };
    }

    case 'tier_count': {
      if (!query.skirt_and_hemline.has_skirt_section || !candidate.skirt_and_hemline.has_skirt_section) {
        return {};
      }
      const qTiers = query.skirt_and_hemline.tier_count;
      const cTiers = candidate.skirt_and_hemline.tier_count;
      if (qTiers === cTiers) {
        if (qTiers === 0) return {};
        return { matchedLabel: qTiers === 1 ? 'Single-Tier Skirt' : `${qTiers}-Tiered Skirt` };
      }
      return { diffLabel: `Diff: ${cTiers}-tier vs. ${qTiers}-tier skirt` };
    }

    case 'garment_length': {
      const qLen = query.silhouette.garment_length;
      const cLen = candidate.silhouette.garment_length;
      return qLen === cLen
        ? { matchedLabel: `${GARMENT_LENGTH_LABELS[qLen]} Length` }
        : {
            diffLabel: `Diff: ${GARMENT_LENGTH_LABELS[cLen]} length vs. ${GARMENT_LENGTH_LABELS[qLen]}`,
          };
    }

    case 'hemline_shape': {
      const qHem = query.skirt_and_hemline.hemline_shape;
      const cHem = candidate.skirt_and_hemline.hemline_shape;
      return qHem === cHem
        ? { matchedLabel: HEMLINE_SHAPE_LABELS[qHem] }
        : { diffLabel: `Diff: ${HEMLINE_SHAPE_LABELS[cHem]} vs. ${HEMLINE_SHAPE_LABELS[qHem]}` };
    }

    case 'slit_detail': {
      const qSlit = query.skirt_and_hemline.slit_detail;
      const cSlit = candidate.skirt_and_hemline.slit_detail;
      if (qSlit === cSlit) {
        return qSlit !== 'none' ? { matchedLabel: SLIT_DETAIL_LABELS[qSlit] } : {};
      }
      return {
        diffLabel: `Diff: ${SLIT_DETAIL_LABELS[cSlit]} vs. ${SLIT_DETAIL_LABELS[qSlit]}`,
      };
    }

    case 'pockets': {
      const qPockets = query.skirt_and_hemline.pockets.filter((p) => p !== 'none_visible');
      const cPockets = candidate.skirt_and_hemline.pockets.filter((p) => p !== 'none_visible');
      const cSet = new Set(cPockets);
      const shared = qPockets.filter((p) => cSet.has(p));
      if (shared.length > 0) {
        return { matchedLabel: shared.map((p) => POCKET_TYPE_LABELS[p]).join(' + ') };
      }
      if (qPockets.length === 0 && cPockets.length === 0) {
        return {};
      }
      const cLabel =
        cPockets.length > 0
          ? cPockets.map((p) => POCKET_TYPE_LABELS[p]).join(' + ')
          : POCKET_TYPE_LABELS.none_visible;
      const qLabel =
        qPockets.length > 0
          ? qPockets.map((p) => POCKET_TYPE_LABELS[p]).join(' + ')
          : POCKET_TYPE_LABELS.none_visible;
      return { diffLabel: `Diff: ${cLabel} vs. ${qLabel}` };
    }

    case 'overall_shape': {
      const qShape = query.silhouette.overall_shape;
      const cShape = candidate.silhouette.overall_shape;
      return qShape === cShape
        ? { matchedLabel: `${OVERALL_SHAPE_LABELS[qShape]} Silhouette` }
        : {
            diffLabel: `Diff: ${OVERALL_SHAPE_LABELS[cShape]} vs. ${OVERALL_SHAPE_LABELS[qShape]} silhouette`,
          };
    }

    case 'substrate_compatibility': {
      const qSub = query.substrate_compatibility;
      const cSub = candidate.substrate_compatibility;
      if (isSubstrateCompatible(qSub, cSub)) {
        return {
          matchedLabel:
            qSub === cSub
              ? `${SUBSTRATE_LABELS[qSub]} Fabric Block`
              : `Compatible (${SUBSTRATE_LABELS[cSub]}) Block`,
        };
      }
      return { diffLabel: `Note: Drafted for ${SUBSTRATE_LABELS[cSub]}` };
    }

    case 'primary_closure': {
      const qClosure = query.closures_and_details.primary_closure;
      const cClosure = candidate.closures_and_details.primary_closure;
      return qClosure === cClosure
        ? { matchedLabel: PRIMARY_CLOSURE_LABELS[qClosure] }
        : {
            diffLabel: `Diff: ${PRIMARY_CLOSURE_LABELS[cClosure]} vs. ${PRIMARY_CLOSURE_LABELS[qClosure]}`,
          };
    }
  }
}

function shouldSkipMatchedSlot(
  slot: ChipSlot,
  emittedSlots: ReadonlySet<ChipSlot>,
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): boolean {
  if (
    slot === 'sleeve_length' &&
    emittedSlots.has('sleeve_style') &&
    query.sleeves_and_armscye.sleeve_style !== 'none_sleeveless' &&
    query.sleeves_and_armscye.sleeve_length === candidate.sleeves_and_armscye.sleeve_length
  ) {
    return true;
  }
  if (
    slot === 'garment_length' &&
    emittedSlots.has('skirt_construction') &&
    query.silhouette.garment_length === candidate.silhouette.garment_length
  ) {
    return true;
  }
  return false;
}

function shouldSkipDiffSlot(
  slot: ChipSlot,
  emittedSlots: ReadonlySet<ChipSlot>,
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): boolean {
  const involvesSleeveless =
    query.sleeves_and_armscye.sleeve_style === 'none_sleeveless' ||
    candidate.sleeves_and_armscye.sleeve_style === 'none_sleeveless';
  if (
    involvesSleeveless &&
    emittedSlots.has('sleeve_style') &&
    (slot === 'armscye_construction' || slot === 'sleeve_length')
  ) {
    return true;
  }
  return false;
}

/**
 * Generates deterministic Matched (<=4) and Diff/Minor Hack (<=2 when totalScore >= 0.62)
 * explanation chips ordered by active FocusRegion priority per Spec §5.4.3 Step C.
 */
export function buildExplanationChips(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1,
  region: FocusRegion,
  totalScore: number
): { matched: MatchChip[]; diffs: MatchChip[] } {
  const matched: MatchChip[] = [];
  const emittedMatchedSlots = new Set<ChipSlot>();

  for (const slot of MATCHED_SLOT_PRIORITY[region]) {
    if (matched.length >= MAX_MATCHED_CHIPS) break;
    if (shouldSkipMatchedSlot(slot, emittedMatchedSlots, query, candidate)) continue;

    const result = evaluateSlot(slot, query, candidate);
    if (result.matchedLabel) {
      matched.push({ kind: 'matched', slot, label: result.matchedLabel });
      emittedMatchedSlots.add(slot);
    }
  }

  const diffs: MatchChip[] = [];
  if (totalScore >= DIFF_SCORE_THRESHOLD) {
    const emittedDiffSlots = new Set<ChipSlot>();
    for (const slot of DIFF_SLOT_PRIORITY[region]) {
      if (diffs.length >= MAX_DIFF_CHIPS) break;
      if (shouldSkipDiffSlot(slot, emittedDiffSlots, query, candidate)) continue;

      const result = evaluateSlot(slot, query, candidate);
      if (result.diffLabel) {
        diffs.push({ kind: 'diff', slot, label: result.diffLabel });
        emittedDiffSlots.add(slot);
      }
    }
  }

  return { matched, diffs };
}
