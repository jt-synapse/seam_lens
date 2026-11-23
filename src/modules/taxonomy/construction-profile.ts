import { z } from 'zod';

export const FOCUS_REGIONS = [
  'full_silhouette',
  'bodice_neckline',
  'sleeves_armscye',
  'skirt_hemline',
] as const;
export type FocusRegion = (typeof FOCUS_REGIONS)[number];
export const FocusRegionSchema = z.enum(FOCUS_REGIONS);

export const GARMENT_CATEGORIES = ['dress', 'top'] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];
export const GarmentCategorySchema = z.enum(GARMENT_CATEGORIES);

export const SUBSTRATE_COMPATIBILITIES = ['woven', 'knit', 'both'] as const;
export type SubstrateCompatibility = (typeof SUBSTRATE_COMPATIBILITIES)[number];
export const SubstrateCompatibilitySchema = z.enum(SUBSTRATE_COMPATIBILITIES);

export const DELIVERY_FORMATS = [
  'pdf_a4_letter',
  'pdf_a0',
  'projector',
  'paper_envelope',
] as const;
export type DeliveryFormat = (typeof DELIVERY_FORMATS)[number];
export const DeliveryFormatSchema = z.enum(DELIVERY_FORMATS);

export const SKILL_LEVELS = [
  'confident_beginner',
  'intermediate',
  'advanced_couture',
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];
export const SkillLevelSchema = z.enum(SKILL_LEVELS);

export const OVERALL_SHAPES = [
  'a_line',
  'fit_and_flare',
  'empire',
  'shift_column',
  'sheath_fitted',
  'tiered_smock',
  'wrap',
  'shirt_dress_blouse',
  'bias_slip',
  'peplum',
  'boxy_cropped',
  'trapeze_tent',
] as const;

export const EASE_LEVELS = [
  'negative_ease',
  'close_fitting',
  'semi_fitted',
  'relaxed',
  'oversized',
] as const;

export const GARMENT_LENGTHS = [
  'cropped',
  'hip_length',
  'tunic',
  'mini',
  'knee',
  'midi',
  'maxi',
] as const;

export const NECKLINE_TYPES = [
  'crew_round',
  'scoop',
  'v_neck',
  'surplice_wrap',
  'square',
  'sweetheart',
  'boat_bateau',
  'cowl',
  'halter',
  'collared_shirt',
  'mandarin_band',
  'tie_neck_bow',
  'off_shoulder',
  'one_shoulder',
  'high_mock_turtleneck',
  'keyhole',
] as const;

export const NECKLINE_DEPTHS = ['high', 'modest_mid', 'deep_plunging'] as const;

export const COLLAR_TYPES = [
  'none',
  'classic_point',
  'peter_pan',
  'camp_revere',
  'band_stand',
  'shawl',
  'ruffle_frill',
] as const;

export const SHAPING_DARTS_SEAMS = [
  'bust_dart',
  'waist_dart',
  'french_dart',
  'princess_seam_shoulder',
  'princess_seam_armscye',
  'shirring_elastic',
  'gathers_yoke',
  'tucks_pleats',
  'boning_corsetry',
  'bias_drape',
  'none_cut_straight',
] as const;

export const WAIST_DEFINITIONS = [
  'natural_seam',
  'empire_seam',
  'dropped_waist_seam',
  'no_waist_seam_continuous',
  'cinched_tie_belt',
  'elasticated_waist',
] as const;

export const BACK_DETAILS = [
  'closed_solid',
  'low_open_back',
  'cutout',
  'tie_back',
  'shirred_back_panel',
  'unknown',
] as const;

export const ARMSCYE_CONSTRUCTIONS = [
  'set_in',
  'dropped_shoulder',
  'raglan',
  'dolman_grown_on',
  'yoke_sleeve',
  'sleeveless_straps',
  'sleeveless_cut_in',
] as const;

export const SLEEVE_STYLES = [
  'none_sleeveless',
  'spaghetti_camisole',
  'wide_strap',
  'cap',
  'fitted_straight',
  'puff_gathered_cap',
  'puff_gathered_hem',
  'puff_full_lantern',
  'bishop',
  'flutter_bell',
  'fluted_flare',
  'kimono_wide',
] as const;

export const SLEEVE_LENGTHS = [
  'sleeveless',
  'cap',
  'short',
  'elbow',
  'three_quarter',
  'wrist_long',
] as const;

export const CUFF_FINISHES = [
  'none_hemmed',
  'elastic_casing',
  'buttoned_placket_cuff',
  'band_cuff',
  'tie_cuff',
  'bias_bound',
] as const;

export const SKIRT_CONSTRUCTIONS = [
  'none_top_hem',
  'gathered_rectangle',
  'tiered_gathered',
  'a_line_panel',
  'gored_panels',
  'circle_half_full',
  'bias_cut',
  'wrap_overlap',
  'pleated_box_knife',
  'pencil_straight',
  'tulip_draped',
] as const;

export const TIER_COUNTS = [0, 1, 2, 3] as const;

export const SLIT_DETAILS = [
  'none',
  'side_slit',
  'front_slit',
  'back_vent',
  'wrap_opening',
] as const;

export const HEMLINE_SHAPES = [
  'straight_level',
  'curved_shirt_tail',
  'high_low',
  'asymmetric',
  'ruffle_flounce',
] as const;

export const POCKET_TYPES = ['none_visible', 'in_seam', 'patch', 'slash_welt'] as const;

export const PRIMARY_CLOSURES = [
  'pullover_no_closure',
  'invisible_zip_back',
  'invisible_zip_side',
  'exposed_zip',
  'button_front_full',
  'button_front_partial_placket',
  'button_back',
  'wrap_tie',
  'hook_keyhole',
  'shirred_stretch',
] as const;

export const FINISH_STRUCTURES = [
  'unlined_faced',
  'lined_bodice',
  'fully_lined',
  'bias_bound',
  'unknown',
] as const;

export const ConstructionProfileV1Schema = z.object({
  schema_version: z.literal(1),
  garment_category: GarmentCategorySchema,
  substrate_compatibility: SubstrateCompatibilitySchema,

  silhouette: z.object({
    overall_shape: z.enum(OVERALL_SHAPES),
    ease_level: z.enum(EASE_LEVELS),
    garment_length: z.enum(GARMENT_LENGTHS),
  }),

  bodice_and_neckline: z.object({
    neckline_type: z.enum(NECKLINE_TYPES),
    neckline_depth: z.enum(NECKLINE_DEPTHS),
    collar_type: z.enum(COLLAR_TYPES),
    shaping_darts_seams: z.array(z.enum(SHAPING_DARTS_SEAMS)),
    waist_definition: z.enum(WAIST_DEFINITIONS),
    back_detail: z.enum(BACK_DETAILS),
  }),

  sleeves_and_armscye: z.object({
    armscye_construction: z.enum(ARMSCYE_CONSTRUCTIONS),
    sleeve_style: z.enum(SLEEVE_STYLES),
    sleeve_length: z.enum(SLEEVE_LENGTHS),
    cuff_finish: z.enum(CUFF_FINISHES),
  }),

  skirt_and_hemline: z.object({
    has_skirt_section: z.boolean(),
    skirt_construction: z.enum(SKIRT_CONSTRUCTIONS),
    tier_count: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    slit_detail: z.enum(SLIT_DETAILS),
    hemline_shape: z.enum(HEMLINE_SHAPES),
    pockets: z.array(z.enum(POCKET_TYPES)),
  }),

  closures_and_details: z.object({
    primary_closure: z.enum(PRIMARY_CLOSURES),
    finish_structure: z.enum(FINISH_STRUCTURES),
  }),

  structural_nuance_notes: z.object({
    bodice_neckline: z.string().max(300),
    sleeves_armscye: z.string().max(300),
    skirt_hemline: z.string().max(300),
    overall_drape_and_proportions: z.string().max(300),
  }),
});

export type ConstructionProfileV1 = z.infer<typeof ConstructionProfileV1Schema>;
