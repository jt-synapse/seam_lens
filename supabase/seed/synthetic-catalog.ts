import { toVectorLiteral, VECTOR_DIMENSION, withTransaction, type Queryable } from '../../src/lib/db';
import {
  ConstructionProfileV1Schema,
  type ConstructionProfileV1,
  type DeliveryFormat,
  type FocusRegion,
  type SkillLevel,
  type SubstrateCompatibility,
} from '../../src/modules/taxonomy/construction-profile';
import { serializeCanonicalRegions } from '../../src/modules/taxonomy/canonical-serializer';

const BOILERPLATE_KEYS = new Set<string>([
  'region',
  'full_silhouette',
  'bodice_neckline',
  'sleeves_armscye',
  'skirt_hemline',
  'notes',
  'category',
  'substrate',
  'silhouette',
  'ease',
  'length',
  'neckline',
  'collar',
  'shaping',
  'waist_definition',
  'back_detail',
  'armscye',
  'sleeve',
  'skirt',
  'tiers',
  'slit',
  'hem',
  'pockets',
  'closure',
  'finish',
  'sleeve_style',
  'sleeve_length',
  'cuff_finish',
  'skirt_construction',
  'tier_count',
  'slit_detail',
  'hemline_shape',
  'garment_length',
  'none',
  'unknown',
]);

function fnv1a32(input: string, seedOffset: number): number {
  let hash = (0x811c9dc5 ^ seedOffset) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addHashedFeature(vec: Float64Array, feature: string, weight: number): void {
  const h1 = fnv1a32(feature, 0x9e3779b1);
  const h2 = fnv1a32(feature, 0x85ebca6b);
  const idx = h1 % VECTOR_DIMENSION;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  vec[idx] += sign * weight;

  // Dual projection stabilizes low-token-count texts against hash collisions
  const idx2 = (h2 >>> 1) % VECTOR_DIMENSION;
  const sign2 = (h1 & 2) === 0 ? 1 : -1;
  vec[idx2] += sign2 * (weight * 0.5);
}

/**
 * Deterministically maps canonical construction text to an L2-normalized 768-d vector
 * using signed feature hashing over structural tokens, sub-tokens, and bigrams.
 */
export function deterministicTextToVector768(text: string): number[] {
  const vec = new Float64Array(VECTOR_DIMENSION);
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const semanticTokens = rawTokens.filter((token) => !BOILERPLATE_KEYS.has(token));
  const activeTokens = semanticTokens.length > 0 ? semanticTokens : rawTokens;

  for (let i = 0; i < activeTokens.length; i += 1) {
    const token = activeTokens[i];
    addHashedFeature(vec, `tok:${token}`, 2.5);

    if (token.includes('_')) {
      const subTokens = token.split('_').filter(Boolean);
      for (const sub of subTokens) {
        if (!BOILERPLATE_KEYS.has(sub)) {
          addHashedFeature(vec, `sub:${sub}`, 1.0);
        }
      }
    }

    if (i + 1 < activeTokens.length) {
      addHashedFeature(vec, `bi:${token}|${activeTokens[i + 1]}`, 2.0);
    }

    if (token.length >= 4) {
      for (let c = 0; c <= token.length - 4; c += 1) {
        addHashedFeature(vec, `cg:${token.slice(c, c + 4)}`, 0.3);
      }
    }
  }

  let normSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    normSq += vec[i] * vec[i];
  }

  if (normSq === 0) {
    const fallback = new Array<number>(VECTOR_DIMENSION).fill(0);
    fallback[0] = 1;
    return fallback;
  }

  const norm = Math.sqrt(normSq);
  return Array.from(vec, (v) => v / norm);
}

interface SeedMaker {
  slug: string;
  name: string;
  storefrontUrl: string;
  platformType: 'shopify' | 'woocommerce' | 'custom';
  permissionNote: string;
  utmCampaignSlug: string;
  affiliateQueryParam: string | null;
}

interface SeedSizeBand {
  externalProductId: string;
  bandLabel: string;
  isDefault: boolean;
  productUrl: string;
  priceCents: number;
  currency: string;
  designerSizeLabel: string;
  bustMinIn: number;
  bustMaxIn: number;
  hipMinIn: number | null;
  hipMaxIn: number | null;
}

interface SeedPatternView {
  viewCode: string;
  viewLabel: string;
  isPrimaryView: boolean;
  hasFlats?: boolean;
  profile: ConstructionProfileV1;
}

interface SeedPattern {
  makerSlug: string;
  slug: string;
  title: string;
  garmentCategory: 'dress' | 'top' | 'dress_and_top_set';
  substrateType: SubstrateCompatibility;
  formats: DeliveryFormat[];
  skillLevel: SkillLevel;
  bands: SeedSizeBand[];
  views: SeedPatternView[];
}

interface SeedArchetype {
  slug: string;
  title: string;
  caption: string;
  imagePath: string;
  defaultFocusRegion: FocusRegion;
  sortOrder: number;
  profile: ConstructionProfileV1;
}

function buildProfile(input: ConstructionProfileV1): ConstructionProfileV1 {
  return ConstructionProfileV1Schema.parse(input);
}

const SEED_MAKERS: SeedMaker[] = [
  {
    slug: 'maison-verveine',
    name: 'Maison Verveine',
    storefrontUrl: 'https://maisonverveine.example',
    platformType: 'shopify',
    permissionNote: 'Opt-in permission signed 2026-10-10 by founder',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: 'ref=seamlens',
  },
  {
    slug: 'atelier-sorel',
    name: 'Atelier Sorel',
    storefrontUrl: 'https://ateliersorel.example',
    platformType: 'shopify',
    permissionNote: 'Opt-in permission signed 2026-10-12 by studio lead',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: null,
  },
  {
    slug: 'loom-and-bodice',
    name: 'Loom & Bodice',
    storefrontUrl: 'https://loomandbodice.example',
    platformType: 'woocommerce',
    permissionNote: 'Opt-in permission signed 2026-10-15 by creative director',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: 'partner=seamlens',
  },
  {
    slug: 'camber-and-dart',
    name: 'Camber & Dart',
    storefrontUrl: 'https://camberanddart.example',
    platformType: 'shopify',
    permissionNote: 'Opt-in permission signed 2026-10-18 by patternmaker',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: null,
  },
  {
    slug: 'studio-finch',
    name: 'Studio Finch',
    storefrontUrl: 'https://studiofinch.example',
    platformType: 'custom',
    permissionNote: 'Opt-in permission signed 2026-10-20 by owner',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: 'utm_content=indie_pilot',
  },
  {
    slug: 'threadline-co',
    name: 'Threadline Co.',
    storefrontUrl: 'https://threadlineco.example',
    platformType: 'shopify',
    permissionNote: 'Opt-in permission signed 2026-10-22 by founder',
    utmCampaignSlug: 'seamlens_v1',
    affiliateQueryParam: null,
  },
];

const SEED_PATTERNS: SeedPattern[] = [
  // 1. Multi-band (Straight 32-46 + Curve 44-62) + Multi-view flagship Dress
  {
    makerSlug: 'maison-verveine',
    slug: 'solene-square-puff-midi-dress',
    title: 'Solène Square-Neck Midi Dress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0', 'projector'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'mv-solene-straight',
        bandLabel: 'Straight (0–20)',
        isDefault: true,
        productUrl: 'https://maisonverveine.example/products/solene-dress-straight',
        priceCents: 1800,
        currency: 'USD',
        designerSizeLabel: 'US 0–20 (B/C Cup)',
        bustMinIn: 32.0,
        bustMaxIn: 46.0,
        hipMinIn: 34.0,
        hipMaxIn: 48.0,
      },
      {
        externalProductId: 'mv-solene-curve',
        bandLabel: 'Curve (14–34)',
        isDefault: false,
        productUrl: 'https://maisonverveine.example/products/solene-dress-curve',
        priceCents: 1800,
        currency: 'USD',
        designerSizeLabel: 'US 14–34 (C–H Cup)',
        bustMinIn: 44.0,
        bustMaxIn: 62.0,
        hipMinIn: 46.0,
        hipMaxIn: 64.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_puff_midi',
        viewLabel: 'View A — Square-Neck Puff Midi',
        isPrimaryView: true,
        profile: buildProfile({
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
            bodice_neckline: 'Faced square neckline with front bust darts and waist darts',
            sleeves_armscye: 'Set-in puff sleeve with gathered shoulder cap and elastic elbow casing',
            skirt_hemline: 'Gathered midi skirt panel at natural waist with deep in-seam pockets',
            overall_drape_and_proportions: 'Close-fitting woven bodice with full gathered midi skirt',
          },
        }),
      },
      {
        viewCode: 'view_b_sleeveless_mini',
        viewLabel: 'View B — Square-Neck Sleeveless Mini',
        isPrimaryView: false,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'fit_and_flare',
            ease_level: 'close_fitting',
            garment_length: 'mini',
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
            armscye_construction: 'sleeveless_straps',
            sleeve_style: 'wide_strap',
            sleeve_length: 'sleeveless',
            cuff_finish: 'none_hemmed',
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
            bodice_neckline: 'Square neckline framed by wide shoulder straps and waist darts',
            sleeves_armscye: 'Sleeveless wide-strap armscye cut cleanly with lined facing',
            skirt_hemline: 'Short gathered mini skirt joined at natural waist',
            overall_drape_and_proportions: 'Fitted structured bodice paired with flared mini hem',
          },
        }),
      },
    ],
  },

  // 2. Cropped Top with nullable hip bounds (passes Bust/Hip filtering under bodice_neckline)
  {
    makerSlug: 'atelier-sorel',
    slug: 'linden-cropped-square-blouse',
    title: 'Linden Cropped Square-Neck Blouse',
    garmentCategory: 'top',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'as-linden-std',
        bandLabel: 'Standard (32–58)',
        isDefault: true,
        productUrl: 'https://ateliersorel.example/products/linden-cropped-blouse',
        priceCents: 1400,
        currency: 'USD',
        designerSizeLabel: 'Sizes A–K (32"–58" Bust)',
        bustMinIn: 32.0,
        bustMaxIn: 58.0,
        hipMinIn: null,
        hipMaxIn: null,
      },
    ],
    views: [
      {
        viewCode: 'view_a_cropped_square',
        viewLabel: 'View A — Cropped Puff-Sleeve Square Top',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'boxy_cropped',
            ease_level: 'semi_fitted',
            garment_length: 'cropped',
          },
          bodice_and_neckline: {
            neckline_type: 'square',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart', 'waist_dart'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'tie_back',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'puff_gathered_cap',
            sleeve_length: 'short',
            cuff_finish: 'elastic_casing',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'lined_bodice',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Cropped woven square bodice with bust darts and back waist tie',
            sleeves_armscye: 'Short set-in puff sleeve gathered into narrow elastic cuff',
            skirt_hemline: 'Cropped straight hem ending above natural waist',
            overall_drape_and_proportions: 'Crisp cropped blouse proportions terminating above hip',
          },
        }),
      },
    ],
  },

  // 3. Print-Trap Decoy #1: Floral Knit Crewneck Tee
  {
    makerSlug: 'threadline-co',
    slug: 'meadow-floral-crew-tee',
    title: 'Meadow Everyday Crew Tee',
    garmentCategory: 'top',
    substrateType: 'knit',
    formats: ['pdf_a4_letter', 'projector'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'tc-meadow-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://threadlineco.example/products/meadow-crew-tee',
        priceCents: 1200,
        currency: 'USD',
        designerSizeLabel: 'XS–4X',
        bustMinIn: 32.0,
        bustMaxIn: 54.0,
        hipMinIn: 34.0,
        hipMaxIn: 56.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_tee',
        viewLabel: 'View A — Classic Short-Sleeve Crew Tee',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'knit',
          silhouette: {
            overall_shape: 'shift_column',
            ease_level: 'semi_fitted',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'crew_round',
            neckline_depth: 'high',
            collar_type: 'none',
            shaping_darts_seams: ['none_cut_straight'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'fitted_straight',
            sleeve_length: 'short',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Floral jersey crew neckband applied with twin-needle topstitch',
            sleeves_armscye: 'Short set-in jersey knit sleeve with flat hem',
            skirt_hemline: 'Simple straight hip-length t-shirt hem',
            overall_drape_and_proportions: 'Relaxed everyday floral knit t-shirt silhouette',
          },
        }),
      },
    ],
  },

  // 4. Print-Trap Decoy #2: Plaid Boxy Camp-Collar Shirt
  {
    makerSlug: 'camber-and-dart',
    slug: 'brier-plaid-camp-shirt',
    title: 'Brier Camp-Collar Boxy Shirt',
    garmentCategory: 'top',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'paper_envelope'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'cd-brier-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://camberanddart.example/products/brier-camp-shirt',
        priceCents: 1600,
        currency: 'USD',
        designerSizeLabel: 'Sizes 1–10',
        bustMinIn: 32.0,
        bustMaxIn: 58.0,
        hipMinIn: 34.0,
        hipMaxIn: 60.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_camp',
        viewLabel: 'View A — Short-Sleeve Camp Shirt',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'shirt_dress_blouse',
            ease_level: 'relaxed',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'collared_shirt',
            neckline_depth: 'modest_mid',
            collar_type: 'camp_revere',
            shaping_darts_seams: ['gathers_yoke'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'dropped_shoulder',
            sleeve_style: 'fitted_straight',
            sleeve_length: 'short',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'side_slit',
            hemline_shape: 'straight_level',
            pockets: ['patch'],
          },
          closures_and_details: {
            primary_closure: 'button_front_full',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Plaid revere camp collar with back yoke pleat and chest patch pocket',
            sleeves_armscye: 'Dropped shoulder short boxy sleeve with turned cuff',
            skirt_hemline: 'Straight boxy shirt hem with small side vents',
            overall_drape_and_proportions: 'Boxy gingham camp shirt cut for crisp shirting',
          },
        }),
      },
    ],
  },

  // 5. Multi-view Dress & Top Set with Straight + Curve bands
  {
    makerSlug: 'atelier-sorel',
    slug: 'claude-bias-cowl-slip',
    title: 'Claude Bias-Cut Slip & Cami Set',
    garmentCategory: 'dress_and_top_set',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'as-claude-straight',
        bandLabel: 'Straight (0–20)',
        isDefault: true,
        productUrl: 'https://ateliersorel.example/products/claude-slip-straight',
        priceCents: 2000,
        currency: 'USD',
        designerSizeLabel: 'US 0–20',
        bustMinIn: 32.0,
        bustMaxIn: 46.0,
        hipMinIn: 34.0,
        hipMaxIn: 48.0,
      },
      {
        externalProductId: 'as-claude-curve',
        bandLabel: 'Curve (14–34)',
        isDefault: false,
        productUrl: 'https://ateliersorel.example/products/claude-slip-curve',
        priceCents: 2000,
        currency: 'USD',
        designerSizeLabel: 'US 14–34',
        bustMinIn: 44.0,
        bustMaxIn: 60.0,
        hipMinIn: 46.0,
        hipMaxIn: 62.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_bias_midi',
        viewLabel: 'View A — Bias-Cut Cowl Midi Slip',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'bias_slip',
            ease_level: 'semi_fitted',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'cowl',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bias_drape'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'low_open_back',
          },
          sleeves_and_armscye: {
            armscye_construction: 'sleeveless_straps',
            sleeve_style: 'spaghetti_camisole',
            sleeve_length: 'sleeveless',
            cuff_finish: 'bias_bound',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'bias_cut',
            tier_count: 0,
            slit_detail: 'side_slit',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'bias_bound',
          },
          structural_nuance_notes: {
            bodice_neckline: '45-degree bias cowl neckline falling softly without bust darts',
            sleeves_armscye: 'Rouleau spaghetti straps over low scoop back armscye',
            skirt_hemline: 'Continuous bias-cut midi skirt skimming hip with single side slit',
            overall_drape_and_proportions: 'Fluid bias-cut silhouette clinging softly through waist',
          },
        }),
      },
      {
        viewCode: 'view_b_bias_cami',
        viewLabel: 'View B — Bias-Cut Cowl Cami Top',
        isPrimaryView: false,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'bias_slip',
            ease_level: 'semi_fitted',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'cowl',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bias_drape'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'low_open_back',
          },
          sleeves_and_armscye: {
            armscye_construction: 'sleeveless_straps',
            sleeve_style: 'spaghetti_camisole',
            sleeve_length: 'sleeveless',
            cuff_finish: 'bias_bound',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'curved_shirt_tail',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'bias_bound',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Bias-cut draped cowl camisole bodice with French seams',
            sleeves_armscye: 'Delicate spaghetti straps joined at bias-bound armscye',
            skirt_hemline: 'Hip-length gently curved cami hem',
            overall_drape_and_proportions: 'Fluid bias drape skimming ribcage to high hip',
          },
        }),
      },
    ],
  },

  // 6. Collared Shirtdress
  {
    makerSlug: 'loom-and-bodice',
    slug: 'marigold-collared-shirtdress',
    title: 'Marigold Belted Shirtdress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0', 'paper_envelope'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'lb-marigold-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://loomandbodice.example/products/marigold-shirtdress',
        priceCents: 2200,
        currency: 'USD',
        designerSizeLabel: 'UK 6–28',
        bustMinIn: 32.0,
        bustMaxIn: 56.0,
        hipMinIn: 34.0,
        hipMaxIn: 58.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_shirtdress',
        viewLabel: 'View A — Classic Collared Belted Shirtdress',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'shirt_dress_blouse',
            ease_level: 'semi_fitted',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'collared_shirt',
            neckline_depth: 'high',
            collar_type: 'classic_point',
            shaping_darts_seams: ['gathers_yoke', 'waist_dart'],
            waist_definition: 'cinched_tie_belt',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'fitted_straight',
            sleeve_length: 'three_quarter',
            cuff_finish: 'buttoned_placket_cuff',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'a_line_panel',
            tier_count: 0,
            slit_detail: 'side_slit',
            hemline_shape: 'curved_shirt_tail',
            pockets: ['patch', 'in_seam'],
          },
          closures_and_details: {
            primary_closure: 'button_front_full',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Two-piece collar stand with classic point collar and front button placket',
            sleeves_armscye: 'Three-quarter tailored sleeve finishing in buttoned tower placket cuff',
            skirt_hemline: 'A-line shirtdress skirt with curved shirt-tail hem and side-seam pockets',
            overall_drape_and_proportions: 'Structured tailored shirtdress cinched with removable tie belt',
          },
        }),
      },
    ],
  },

  // 7. Multi-view Surplice Wrap Dress
  {
    makerSlug: 'studio-finch',
    slug: 'vesper-surplice-wrap-dress',
    title: 'Vesper Surplice Wrap Dress',
    garmentCategory: 'dress',
    substrateType: 'both',
    formats: ['pdf_a4_letter', 'projector'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'sf-vesper-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://studiofinch.example/products/vesper-wrap-dress',
        priceCents: 1800,
        currency: 'USD',
        designerSizeLabel: 'Sizes 0–30',
        bustMinIn: 32.0,
        bustMaxIn: 58.0,
        hipMinIn: 34.0,
        hipMaxIn: 60.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_flutter_midi',
        viewLabel: 'View A — Flutter-Sleeve Wrap Midi',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'both',
          silhouette: {
            overall_shape: 'wrap',
            ease_level: 'close_fitting',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'surplice_wrap',
            neckline_depth: 'deep_plunging',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart', 'waist_dart'],
            waist_definition: 'cinched_tie_belt',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'flutter_bell',
            sleeve_length: 'short',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'wrap_overlap',
            tier_count: 0,
            slit_detail: 'wrap_opening',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'wrap_tie',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'True surplice crossover V bodice stabilized with stay tape and waist ties',
            sleeves_armscye: 'Flared short flutter sleeves set cleanly into natural armscye',
            skirt_hemline: 'Deep overlapping wrap midi skirt with fluid front opening',
            overall_drape_and_proportions: 'Fitted crossover bodice opening into sweeping wrap skirt',
          },
        }),
      },
      {
        viewCode: 'view_b_bishop_maxi',
        viewLabel: 'View B — Bishop-Sleeve Wrap Maxi',
        isPrimaryView: false,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'both',
          silhouette: {
            overall_shape: 'wrap',
            ease_level: 'close_fitting',
            garment_length: 'maxi',
          },
          bodice_and_neckline: {
            neckline_type: 'surplice_wrap',
            neckline_depth: 'deep_plunging',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart', 'waist_dart'],
            waist_definition: 'cinched_tie_belt',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'bishop',
            sleeve_length: 'wrist_long',
            cuff_finish: 'buttoned_placket_cuff',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'wrap_overlap',
            tier_count: 0,
            slit_detail: 'wrap_opening',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'wrap_tie',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Surplice crossover neckline with internal waist stay and tie sash',
            sleeves_armscye: 'Full bishop sleeve gathered into narrow buttoned wrist cuff',
            skirt_hemline: 'Ankle-grazing overlapping wrap maxi skirt',
            overall_drape_and_proportions: 'Romantic wrap maxi with dramatic bishop sleeve volume',
          },
        }),
      },
    ],
  },

  // 8. Tiered Smock Dress
  {
    makerSlug: 'maison-verveine',
    slug: 'cora-tiered-smock-dress',
    title: 'Cora 3-Tier Smock Dress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'mv-cora-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://maisonverveine.example/products/cora-tiered-smock',
        priceCents: 1600,
        currency: 'USD',
        designerSizeLabel: 'XS–5X',
        bustMinIn: 32.0,
        bustMaxIn: 60.0,
        hipMinIn: 34.0,
        hipMaxIn: 62.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_tiered',
        viewLabel: 'View A — Scoop-Neck Three-Tier Smock',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'tiered_smock',
            ease_level: 'oversized',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'scoop',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['gathers_yoke'],
            waist_definition: 'empire_seam',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'dropped_shoulder',
            sleeve_style: 'puff_gathered_hem',
            sleeve_length: 'elbow',
            cuff_finish: 'elastic_casing',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'tiered_gathered',
            tier_count: 3,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Generous scoop bodice with raised empire seam and bias binding',
            sleeves_armscye: 'Dropped-shoulder voluminous elbow sleeve with elastic cuff',
            skirt_hemline: 'Three graduated gathered rectangle tiers with side pockets',
            overall_drape_and_proportions: 'Voluminous pull-on tiered smock silhouette',
          },
        }),
      },
    ],
  },

  // 9. Advanced Couture Princess-Seam Sweetheart Sheath (no projector)
  {
    makerSlug: 'atelier-sorel',
    slug: 'ines-princess-sweetheart-sheath',
    title: 'Inès Princess-Seam Sheath Dress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'advanced_couture',
    bands: [
      {
        externalProductId: 'as-ines-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://ateliersorel.example/products/ines-sheath-dress',
        priceCents: 2600,
        currency: 'USD',
        designerSizeLabel: 'EU 32–52',
        bustMinIn: 32.0,
        bustMaxIn: 50.0,
        hipMinIn: 34.0,
        hipMaxIn: 52.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_sheath',
        viewLabel: 'View A — Boned Sweetheart Princess Sheath',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'sheath_fitted',
            ease_level: 'close_fitting',
            garment_length: 'knee',
          },
          bodice_and_neckline: {
            neckline_type: 'sweetheart',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['princess_seam_armscye', 'boning_corsetry'],
            waist_definition: 'natural_seam',
            back_detail: 'low_open_back',
          },
          sleeves_and_armscye: {
            armscye_construction: 'sleeveless_cut_in',
            sleeve_style: 'none_sleeveless',
            sleeve_length: 'sleeveless',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'pencil_straight',
            tier_count: 0,
            slit_detail: 'back_vent',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'invisible_zip_back',
            finish_structure: 'fully_lined',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Sculpted sweetheart bodice with armscye princess seams and boned lining',
            sleeves_armscye: 'Cut-in sleeveless armscye edged cleanly with bagged lining',
            skirt_hemline: 'Tailored pencil skirt with center-back walking vent',
            overall_drape_and_proportions: 'Architectural contoured sheath silhouette',
          },
        }),
      },
    ],
  },

  // 10. Shirred Empire Square Sundress
  {
    makerSlug: 'threadline-co',
    slug: 'alma-shirred-empire-sundress',
    title: 'Alma Shirred Sundress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'projector'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'tc-alma-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://threadlineco.example/products/alma-shirred-sundress',
        priceCents: 1500,
        currency: 'USD',
        designerSizeLabel: 'XXS–4X',
        bustMinIn: 32.0,
        bustMaxIn: 54.0,
        hipMinIn: 34.0,
        hipMaxIn: 56.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_shirred',
        viewLabel: 'View A — Wide-Strap Shirred Sundress',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'empire',
            ease_level: 'close_fitting',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'square',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['shirring_elastic'],
            waist_definition: 'empire_seam',
            back_detail: 'shirred_back_panel',
          },
          sleeves_and_armscye: {
            armscye_construction: 'sleeveless_straps',
            sleeve_style: 'wide_strap',
            sleeve_length: 'sleeveless',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'gathered_rectangle',
            tier_count: 2,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'shirred_stretch',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Elastic-shirred square bodice hugging torso without darts or zipper',
            sleeves_armscye: 'Wide tie-free shoulder straps anchored into shirred top edge',
            skirt_hemline: 'Two-tier gathered midi skirt falling from high empire line',
            overall_drape_and_proportions: 'Pull-on shirred bodice flowing into breezy two-tier skirt',
          },
        }),
      },
    ],
  },

  // 11. Advanced Couture Boatneck Pleated Fit & Flare (no projector)
  {
    makerSlug: 'camber-and-dart',
    slug: 'noemi-pleated-fit-flare-dress',
    title: 'Noémi Box-Pleat Fit & Flare Dress',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'paper_envelope'],
    skillLevel: 'advanced_couture',
    bands: [
      {
        externalProductId: 'cd-noemi-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://camberanddart.example/products/noemi-pleated-dress',
        priceCents: 2400,
        currency: 'USD',
        designerSizeLabel: 'US 2–22',
        bustMinIn: 32.0,
        bustMaxIn: 48.0,
        hipMinIn: 34.0,
        hipMaxIn: 50.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_pleated',
        viewLabel: 'View A — Boatneck Box-Pleated Midi',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'fit_and_flare',
            ease_level: 'close_fitting',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'boat_bateau',
            neckline_depth: 'high',
            collar_type: 'none',
            shaping_darts_seams: ['princess_seam_shoulder', 'french_dart'],
            waist_definition: 'natural_seam',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'cap',
            sleeve_length: 'cap',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'pleated_box_knife',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'invisible_zip_side',
            finish_structure: 'fully_lined',
          },
          structural_nuance_notes: {
            bodice_neckline: 'High bateau boatneck with shoulder princess seams and French darts',
            sleeves_armscye: 'Tailored set-in cap sleeve curving cleanly over shoulder',
            skirt_hemline: 'Deep crisp box-pleated midi skirt with concealed side pockets',
            overall_drape_and_proportions: 'Architectural 1950s fit-and-flare proportions',
          },
        }),
      },
    ],
  },

  // 12. Raglan Keyhole Bishop Peasant Blouse
  {
    makerSlug: 'loom-and-bodice',
    slug: 'celeste-bishop-peasant-blouse',
    title: 'Céleste Raglan Bishop Blouse',
    garmentCategory: 'top',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'lb-celeste-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://loomandbodice.example/products/celeste-bishop-blouse',
        priceCents: 1500,
        currency: 'USD',
        designerSizeLabel: 'Sizes 0–34',
        bustMinIn: 32.0,
        bustMaxIn: 62.0,
        hipMinIn: 34.0,
        hipMaxIn: 64.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_bishop_top',
        viewLabel: 'View A — Keyhole Raglan Bishop Blouse',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'shirt_dress_blouse',
            ease_level: 'relaxed',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'keyhole',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['gathers_yoke'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'raglan',
            sleeve_style: 'bishop',
            sleeve_length: 'wrist_long',
            cuff_finish: 'elastic_casing',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'curved_shirt_tail',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'hook_keyhole',
            finish_structure: 'bias_bound',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Gathered bias-bound keyhole neckline anchored with hook-and-eye loop',
            sleeves_armscye: 'Generous raglan bishop sleeve tapering into ruffled elastic wrist',
            skirt_hemline: 'Softly curved hip-length blouse hem',
            overall_drape_and_proportions: 'Breezy bohemian raglan blouse with voluminous sleeves',
          },
        }),
      },
    ],
  },

  // 13. Multi-view Knit Wrap Top
  {
    makerSlug: 'studio-finch',
    slug: 'juno-knit-wrap-top',
    title: 'Juno Jersey Wrap Top',
    garmentCategory: 'top',
    substrateType: 'knit',
    formats: ['pdf_a4_letter', 'projector'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'sf-juno-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://studiofinch.example/products/juno-knit-wrap-top',
        priceCents: 1400,
        currency: 'USD',
        designerSizeLabel: 'XXS–5X',
        bustMinIn: 32.0,
        bustMaxIn: 58.0,
        hipMinIn: 34.0,
        hipMaxIn: 60.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_fitted_long',
        viewLabel: 'View A — Long-Sleeve Knit Wrap Top',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'knit',
          silhouette: {
            overall_shape: 'wrap',
            ease_level: 'negative_ease',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'surplice_wrap',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart'],
            waist_definition: 'cinched_tie_belt',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'fitted_straight',
            sleeve_length: 'wrist_long',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'wrap_tie',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Knit crossover surplice wrap bodice stabilized with clear elastic',
            sleeves_armscye: 'Close-fitting set-in long jersey sleeve',
            skirt_hemline: 'Wrap top finishing smoothly at high hip',
            overall_drape_and_proportions: 'Close stretch ballet-wrap silhouette',
          },
        }),
      },
      {
        viewCode: 'view_b_lantern_elbow',
        viewLabel: 'View B — Lantern-Sleeve Knit Wrap Top',
        isPrimaryView: false,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'knit',
          silhouette: {
            overall_shape: 'wrap',
            ease_level: 'close_fitting',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'surplice_wrap',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart'],
            waist_definition: 'cinched_tie_belt',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'puff_full_lantern',
            sleeve_length: 'elbow',
            cuff_finish: 'band_cuff',
          },
          skirt_and_hemline: {
            has_skirt_section: false,
            skirt_construction: 'none_top_hem',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'wrap_tie',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Crossover surplice wrap top with self-fabric wrap waist ties',
            sleeves_armscye: 'Two-piece lantern elbow sleeve finished with knit band cuff',
            skirt_hemline: 'Hip-length crossover wrap hem',
            overall_drape_and_proportions: 'Fitted knit wrap bodice with architectural lantern sleeves',
          },
        }),
      },
    ],
  },

  // 14. V-Neck Circle Skirt Fit & Flare
  {
    makerSlug: 'maison-verveine',
    slug: 'paloma-circle-skirt-fit-flare',
    title: 'Paloma Circle-Skirt Dress',
    garmentCategory: 'dress',
    substrateType: 'both',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'mv-paloma-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://maisonverveine.example/products/paloma-circle-dress',
        priceCents: 1900,
        currency: 'USD',
        designerSizeLabel: 'US 0–28',
        bustMinIn: 32.0,
        bustMaxIn: 56.0,
        hipMinIn: 34.0,
        hipMaxIn: 58.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_circle',
        viewLabel: 'View A — V-Neck Half-Circle Knee Dress',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'both',
          silhouette: {
            overall_shape: 'fit_and_flare',
            ease_level: 'close_fitting',
            garment_length: 'knee',
          },
          bodice_and_neckline: {
            neckline_type: 'v_neck',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['bust_dart', 'waist_dart'],
            waist_definition: 'natural_seam',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'puff_gathered_cap',
            sleeve_length: 'short',
            cuff_finish: 'band_cuff',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'circle_half_full',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'invisible_zip_side',
            finish_structure: 'lined_bodice',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Crisp V-neckline bodice with bust and waist darts',
            sleeves_armscye: 'Short puff sleeve anchored by flat band cuff',
            skirt_hemline: 'Swirling half-circle knee-length skirt with hidden side pockets',
            overall_drape_and_proportions: 'Classic waisted silhouette flaring cleanly from natural waist',
          },
        }),
      },
    ],
  },

  // 15. Peplum Blouse (has_skirt_section = true per Spec §5.2)
  {
    makerSlug: 'camber-and-dart',
    slug: 'sylvie-tie-neck-peplum-blouse',
    title: 'Sylvie Tie-Neck Peplum Blouse',
    garmentCategory: 'top',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'cd-sylvie-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://camberanddart.example/products/sylvie-peplum-blouse',
        priceCents: 1700,
        currency: 'USD',
        designerSizeLabel: 'US 0–26',
        bustMinIn: 32.0,
        bustMaxIn: 54.0,
        hipMinIn: 34.0,
        hipMaxIn: 56.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_peplum',
        viewLabel: 'View A — Bow-Neck Gathered Peplum Top',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'peplum',
            ease_level: 'semi_fitted',
            garment_length: 'hip_length',
          },
          bodice_and_neckline: {
            neckline_type: 'tie_neck_bow',
            neckline_depth: 'high',
            collar_type: 'none',
            shaping_darts_seams: ['tucks_pleats', 'bust_dart'],
            waist_definition: 'natural_seam',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'set_in',
            sleeve_style: 'puff_gathered_hem',
            sleeve_length: 'three_quarter',
            cuff_finish: 'buttoned_placket_cuff',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'gathered_rectangle',
            tier_count: 1,
            slit_detail: 'none',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'button_front_partial_placket',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'High tie-neck pussy-bow collar above partial button placket and shoulder tucks',
            sleeves_armscye: 'Three-quarter blouson sleeve gathered into buttoned wrist band',
            skirt_hemline: 'Flared gathered peplum skirt tier joined at natural waist seam',
            overall_drape_and_proportions: 'Tailored waisted peplum blouse with bow neckline',
          },
        }),
      },
    ],
  },

  // 16. Halter Trapeze Maxi (no flat image paths to exercise UI null-flat guard)
  {
    makerSlug: 'threadline-co',
    slug: 'rowan-trapeze-halter-dress',
    title: 'Rowan Trapeze Halter Maxi',
    garmentCategory: 'dress',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'paper_envelope'],
    skillLevel: 'confident_beginner',
    bands: [
      {
        externalProductId: 'tc-rowan-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://threadlineco.example/products/rowan-halter-maxi',
        priceCents: 1600,
        currency: 'USD',
        designerSizeLabel: 'XS–5X',
        bustMinIn: 32.0,
        bustMaxIn: 60.0,
        hipMinIn: 34.0,
        hipMaxIn: 64.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_halter',
        viewLabel: 'View A — High-Low Halter Trapeze Maxi',
        isPrimaryView: true,
        hasFlats: false,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'trapeze_tent',
            ease_level: 'oversized',
            garment_length: 'maxi',
          },
          bodice_and_neckline: {
            neckline_type: 'halter',
            neckline_depth: 'high',
            collar_type: 'none',
            shaping_darts_seams: ['none_cut_straight'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'tie_back',
          },
          sleeves_and_armscye: {
            armscye_construction: 'sleeveless_cut_in',
            sleeve_style: 'none_sleeveless',
            sleeve_length: 'sleeveless',
            cuff_finish: 'bias_bound',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'a_line_panel',
            tier_count: 0,
            slit_detail: 'none',
            hemline_shape: 'high_low',
            pockets: ['in_seam'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'bias_bound',
          },
          structural_nuance_notes: {
            bodice_neckline: 'High gathered halter neckband tying at back nape',
            sleeves_armscye: 'Deep cut-in sleeveless halter armhole finished with bias tape',
            skirt_hemline: 'Sweeping A-line tent volume with curved high-low maxi hem',
            overall_drape_and_proportions: 'Unfitted trapeze swing suspended from halter neck',
          },
        }),
      },
    ],
  },

  // 17. Off-Shoulder Gored Midi Dress
  {
    makerSlug: 'atelier-sorel',
    slug: 'odette-off-shoulder-gored-midi',
    title: 'Odette Off-Shoulder Gored Dress',
    garmentCategory: 'dress',
    substrateType: 'both',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'intermediate',
    bands: [
      {
        externalProductId: 'as-odette-std',
        bandLabel: 'Standard',
        isDefault: true,
        productUrl: 'https://ateliersorel.example/products/odette-gored-midi',
        priceCents: 1900,
        currency: 'USD',
        designerSizeLabel: 'US 0–28',
        bustMinIn: 32.0,
        bustMaxIn: 56.0,
        hipMinIn: 34.0,
        hipMaxIn: 58.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_gored',
        viewLabel: 'View A — Fluted-Sleeve Gored Midi',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'dress',
          substrate_compatibility: 'both',
          silhouette: {
            overall_shape: 'a_line',
            ease_level: 'semi_fitted',
            garment_length: 'midi',
          },
          bodice_and_neckline: {
            neckline_type: 'off_shoulder',
            neckline_depth: 'modest_mid',
            collar_type: 'none',
            shaping_darts_seams: ['princess_seam_armscye'],
            waist_definition: 'elasticated_waist',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'dropped_shoulder',
            sleeve_style: 'fluted_flare',
            sleeve_length: 'elbow',
            cuff_finish: 'none_hemmed',
          },
          skirt_and_hemline: {
            has_skirt_section: true,
            skirt_construction: 'gored_panels',
            tier_count: 0,
            slit_detail: 'side_slit',
            hemline_shape: 'straight_level',
            pockets: ['none_visible'],
          },
          closures_and_details: {
            primary_closure: 'pullover_no_closure',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Elasticated off-shoulder Bardot neckline with vertical bodice seams',
            sleeves_armscye: 'Flared fluted elbow sleeves integrated across dropped shoulder seam',
            skirt_hemline: 'Six-gore A-line midi skirt with high side slit',
            overall_drape_and_proportions: 'Clean panelled A-line drape cinched lightly at elasticated waist',
          },
        }),
      },
    ],
  },

  // 18. Curve-Only Advanced Couture Mandarin Tunic (no projector)
  {
    makerSlug: 'loom-and-bodice',
    slug: 'margot-mandarin-tunic-blouse',
    title: 'Margot Pintuck Mandarin Tunic',
    garmentCategory: 'top',
    substrateType: 'woven',
    formats: ['pdf_a4_letter', 'pdf_a0'],
    skillLevel: 'advanced_couture',
    bands: [
      {
        externalProductId: 'lb-margot-curve',
        bandLabel: 'Curve Plus (16–36)',
        isDefault: true,
        productUrl: 'https://loomandbodice.example/products/margot-mandarin-tunic',
        priceCents: 2100,
        currency: 'USD',
        designerSizeLabel: 'US 16–36',
        bustMinIn: 44.0,
        bustMaxIn: 64.0,
        hipMinIn: 46.0,
        hipMaxIn: 66.0,
      },
    ],
    views: [
      {
        viewCode: 'view_a_mandarin',
        viewLabel: 'View A — Pintuck Mandarin Yoke Tunic',
        isPrimaryView: true,
        profile: buildProfile({
          schema_version: 1,
          garment_category: 'top',
          substrate_compatibility: 'woven',
          silhouette: {
            overall_shape: 'shirt_dress_blouse',
            ease_level: 'relaxed',
            garment_length: 'tunic',
          },
          bodice_and_neckline: {
            neckline_type: 'mandarin_band',
            neckline_depth: 'high',
            collar_type: 'band_stand',
            shaping_darts_seams: ['tucks_pleats', 'gathers_yoke'],
            waist_definition: 'no_waist_seam_continuous',
            back_detail: 'closed_solid',
          },
          sleeves_and_armscye: {
            armscye_construction: 'yoke_sleeve',
            sleeve_style: 'fitted_straight',
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
            primary_closure: 'button_front_partial_placket',
            finish_structure: 'unlined_faced',
          },
          structural_nuance_notes: {
            bodice_neckline: 'Standing mandarin band collar with pintuck bib and concealed partial placket',
            sleeves_armscye: 'Shoulder-yoke long sleeves terminating in buttoned tailored cuffs',
            skirt_hemline: 'Tunic-length curved shirt-tail hem with deep side gussets',
            overall_drape_and_proportions: 'Relaxed pintuck tunic tailored cleanly for fuller busts',
          },
        }),
      },
    ],
  },
];

const SEED_ARCHETYPES: SeedArchetype[] = [
  {
    slug: 'square-neck-puff-midi',
    title: 'Square-Neck Puff Midi',
    caption: 'Structured woven bodice, bust & waist darts, elbow puff sleeves, gathered midi skirt',
    imagePath: 'catalog-media/archetypes/square-neck-puff-midi.webp',
    defaultFocusRegion: 'full_silhouette',
    sortOrder: 1,
    profile: SEED_PATTERNS[0].views[0].profile,
  },
  {
    slug: 'bias-cut-cowl-slip',
    title: 'Bias-Cut Cowl Slip',
    caption: '45-degree bias drape, cowl neckline, spaghetti straps, fluid midi skirt',
    imagePath: 'catalog-media/archetypes/bias-cut-cowl-slip.webp',
    defaultFocusRegion: 'full_silhouette',
    sortOrder: 2,
    profile: SEED_PATTERNS[4].views[0].profile,
  },
  {
    slug: 'collared-button-shirtdress',
    title: 'Tailored Belted Shirtdress',
    caption: 'Point collar on stand, full button placket, tower-cuff sleeves, belted A-line skirt',
    imagePath: 'catalog-media/archetypes/collared-button-shirtdress.webp',
    defaultFocusRegion: 'bodice_neckline',
    sortOrder: 3,
    profile: SEED_PATTERNS[5].views[0].profile,
  },
  {
    slug: 'surplice-wrap-flutter-top',
    title: 'Surplice Wrap Flutter',
    caption: 'Deep crossover wrap bodice with short flutter sleeves and cinched waist ties',
    imagePath: 'catalog-media/archetypes/surplice-wrap-flutter-top.webp',
    defaultFocusRegion: 'sleeves_armscye',
    sortOrder: 4,
    profile: SEED_PATTERNS[6].views[0].profile,
  },
];

function computeProfileEmbeddings(profile: ConstructionProfileV1) {
  const canonical = serializeCanonicalRegions(profile);
  const vecFull = deterministicTextToVector768(canonical.full_silhouette);
  const vecBodice = deterministicTextToVector768(canonical.bodice_neckline);
  const vecSleeves = deterministicTextToVector768(canonical.sleeves_armscye);
  const vecSkirt = canonical.skirt_hemline
    ? deterministicTextToVector768(canonical.skirt_hemline)
    : null;

  return {
    canonical,
    vecFullLit: toVectorLiteral(vecFull)!,
    vecBodiceLit: toVectorLiteral(vecBodice)!,
    vecSleevesLit: toVectorLiteral(vecSleeves)!,
    vecSkirtLit: toVectorLiteral(vecSkirt),
  };
}

/**
 * Idempotently seeds Stage-A fictional approved makers, 18 published patterns (22 views),
 * Straight/Curve split size bands, nullable-hip cropped top, print-trap decoys, and 4 curated archetypes.
 */
export async function seedSyntheticCatalog(db: Queryable): Promise<{
  makerCount: number;
  patternCount: number;
  viewCount: number;
  archetypeCount: number;
}> {
  return withTransaction(db, async (tx) => {
    const makerIdsBySlug = new Map<string, string>();

    for (const maker of SEED_MAKERS) {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO makers (
          slug, name, storefront_url, platform_type, vetted_status,
          permission_evidence_note, utm_campaign_slug, affiliate_query_param
        ) VALUES ($1, $2, $3, $4, 'approved', $5, $6, $7)
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          storefront_url = EXCLUDED.storefront_url,
          platform_type = EXCLUDED.platform_type,
          vetted_status = 'approved',
          permission_evidence_note = EXCLUDED.permission_evidence_note,
          utm_campaign_slug = EXCLUDED.utm_campaign_slug,
          affiliate_query_param = EXCLUDED.affiliate_query_param,
          updated_at = now()
        RETURNING id`,
        [
          maker.slug,
          maker.name,
          maker.storefrontUrl,
          maker.platformType,
          maker.permissionNote,
          maker.utmCampaignSlug,
          maker.affiliateQueryParam,
        ]
      );
      makerIdsBySlug.set(maker.slug, res.rows[0].id);
    }

    let totalViews = 0;

    for (const pattern of SEED_PATTERNS) {
      const makerId = makerIdsBySlug.get(pattern.makerSlug);
      if (!makerId) {
        throw new Error(`Missing seeded maker for slug ${pattern.makerSlug}`);
      }

      // Insert/upsert as draft first so child size bands & views exist before publish trigger fires
      const patternRes = await tx.query<{ id: string }>(
        `INSERT INTO patterns (
          maker_id, slug, title, garment_category, substrate_type, formats, skill_level, status
        ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7, 'draft')
        ON CONFLICT (slug) DO UPDATE SET
          maker_id = EXCLUDED.maker_id,
          title = EXCLUDED.title,
          garment_category = EXCLUDED.garment_category,
          substrate_type = EXCLUDED.substrate_type,
          formats = EXCLUDED.formats,
          skill_level = EXCLUDED.skill_level,
          updated_at = now()
        RETURNING id`,
        [
          makerId,
          pattern.slug,
          pattern.title,
          pattern.garmentCategory,
          pattern.substrateType,
          pattern.formats,
          pattern.skillLevel,
        ]
      );
      const patternId = patternRes.rows[0].id;

      for (const band of pattern.bands) {
        await tx.query(
          `INSERT INTO pattern_size_bands (
            pattern_id, maker_id, external_product_id, band_label, is_default,
            product_url, price_cents, currency, designer_size_label,
            bust_min_in, bust_max_in, hip_min_in, hip_max_in
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (pattern_id, band_label) DO UPDATE SET
            maker_id = EXCLUDED.maker_id,
            external_product_id = EXCLUDED.external_product_id,
            is_default = EXCLUDED.is_default,
            product_url = EXCLUDED.product_url,
            price_cents = EXCLUDED.price_cents,
            currency = EXCLUDED.currency,
            designer_size_label = EXCLUDED.designer_size_label,
            bust_min_in = EXCLUDED.bust_min_in,
            bust_max_in = EXCLUDED.bust_max_in,
            hip_min_in = EXCLUDED.hip_min_in,
            hip_max_in = EXCLUDED.hip_max_in`,
          [
            patternId,
            makerId,
            band.externalProductId,
            band.bandLabel,
            band.isDefault,
            band.productUrl,
            band.priceCents,
            band.currency,
            band.designerSizeLabel,
            band.bustMinIn,
            band.bustMaxIn,
            band.hipMinIn,
            band.hipMaxIn,
          ]
        );
      }

      for (const view of pattern.views) {
        const { canonical, vecFullLit, vecBodiceLit, vecSleevesLit, vecSkirtLit } =
          computeProfileEmbeddings(view.profile);
        const mediaBase = `catalog-media/${pattern.makerSlug}/${pattern.slug}/${view.viewCode}`;
        const hasFlats = view.hasFlats ?? true;

        await tx.query(
          `INSERT INTO pattern_views (
            pattern_id, view_code, view_label, garment_category, is_primary_view,
            cover_image_path, flat_front_image_path, flat_back_image_path,
            construction_profile, canonical_texts,
            vec_full, vec_bodice, vec_sleeves, vec_skirt,
            ai_confidence, human_verified
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8,
            $9::jsonb, $10::jsonb,
            $11::vector, $12::vector, $13::vector, $14::vector,
            0.98, true
          )
          ON CONFLICT (pattern_id, view_code) DO UPDATE SET
            view_label = EXCLUDED.view_label,
            garment_category = EXCLUDED.garment_category,
            is_primary_view = EXCLUDED.is_primary_view,
            cover_image_path = EXCLUDED.cover_image_path,
            flat_front_image_path = EXCLUDED.flat_front_image_path,
            flat_back_image_path = EXCLUDED.flat_back_image_path,
            construction_profile = EXCLUDED.construction_profile,
            canonical_texts = EXCLUDED.canonical_texts,
            vec_full = EXCLUDED.vec_full,
            vec_bodice = EXCLUDED.vec_bodice,
            vec_sleeves = EXCLUDED.vec_sleeves,
            vec_skirt = EXCLUDED.vec_skirt,
            ai_confidence = EXCLUDED.ai_confidence,
            human_verified = EXCLUDED.human_verified,
            updated_at = now()`,
          [
            patternId,
            view.viewCode,
            view.viewLabel,
            view.profile.garment_category,
            view.isPrimaryView,
            `${mediaBase}-cover.webp`,
            hasFlats ? `${mediaBase}-flat-front.webp` : null,
            hasFlats ? `${mediaBase}-flat-back.webp` : null,
            JSON.stringify(view.profile),
            JSON.stringify(canonical),
            vecFullLit,
            vecBodiceLit,
            vecSleevesLit,
            vecSkirtLit,
          ]
        );
        totalViews += 1;
      }

      // Trigger enforce_pattern_publish_readiness validates maker, size bands, and views
      await tx.query(
        `UPDATE patterns
            SET status = 'published',
                published_at = COALESCE(published_at, now())
          WHERE id = $1`,
        [patternId]
      );
    }

    for (const archetype of SEED_ARCHETYPES) {
      const { vecFullLit, vecBodiceLit, vecSleevesLit, vecSkirtLit } = computeProfileEmbeddings(
        archetype.profile
      );

      await tx.query(
        `INSERT INTO curated_archetypes (
          slug, title, caption, image_path, default_focus_region,
          extracted_profile, vec_full, vec_bodice, vec_sleeves, vec_skirt,
          sort_order, active
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::jsonb, $7::vector, $8::vector, $9::vector, $10::vector,
          $11, true
        )
        ON CONFLICT (slug) DO UPDATE SET
          title = EXCLUDED.title,
          caption = EXCLUDED.caption,
          image_path = EXCLUDED.image_path,
          default_focus_region = EXCLUDED.default_focus_region,
          extracted_profile = EXCLUDED.extracted_profile,
          vec_full = EXCLUDED.vec_full,
          vec_bodice = EXCLUDED.vec_bodice,
          vec_sleeves = EXCLUDED.vec_sleeves,
          vec_skirt = EXCLUDED.vec_skirt,
          sort_order = EXCLUDED.sort_order,
          active = true`,
        [
          archetype.slug,
          archetype.title,
          archetype.caption,
          archetype.imagePath,
          archetype.defaultFocusRegion,
          JSON.stringify(archetype.profile),
          vecFullLit,
          vecBodiceLit,
          vecSleevesLit,
          vecSkirtLit,
          archetype.sortOrder,
        ]
      );
    }

    return {
      makerCount: SEED_MAKERS.length,
      patternCount: SEED_PATTERNS.length,
      viewCount: totalViews,
      archetypeCount: SEED_ARCHETYPES.length,
    };
  });
}
