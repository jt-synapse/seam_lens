import type { ConstructionProfileV1 } from './construction-profile';

export interface CanonicalRegionTexts {
  full_silhouette: string;
  bodice_neckline: string;
  sleeves_armscye: string;
  skirt_hemline: string | null;
}

const SURFACE_PRINT_COLOR_DENYLIST = new Set<string>([
  'floral',
  'gingham',
  'plaid',
  'tartan',
  'polka',
  'polka-dot',
  'polka-dots',
  'dot',
  'dots',
  'spotted',
  'stripe',
  'striped',
  'stripes',
  'pinstripe',
  'breton',
  'paisley',
  'leopard',
  'houndstooth',
  'check',
  'checked',
  'checkered',
  'crimson',
  'red',
  'blue',
  'navy',
  'ivory',
  'emerald',
  'sage',
  'terracotta',
  'pink',
  'yellow',
  'purple',
  'black',
  'white',
  'beige',
  'liberty',
  'acid-wash',
  'stone-wash',
  'stonewash',
  'bleach',
  'bleached',
  'tie-dye',
  'dyed',
  'print',
  'printed',
  'patterned',
  'multicolor',
  'multi-color',
  'camo',
  'camouflage',
  'zebra',
  'cheetah',
  'botanical',
  'ditsy',
  'green',
  'orange',
  'brown',
  'grey',
  'gray',
  'teal',
  'coral',
  'olive',
  'burgundy',
  'maroon',
  'indigo',
  'cobalt',
  'charcoal',
  'khaki',
  'tan',
  'cream',
  'lavender',
  'lilac',
  'mustard',
  'ochre',
  'rust',
  'magenta',
  'pastel',
  'neon',
]);

const TOKEN_EDGE_PUNCTUATION = /^([("'`\[]*)(.*?)([),.;:!?"'`\]]*)$/;

function cleanToken(token: string): string | null {
  const match = TOKEN_EDGE_PUNCTUATION.exec(token);
  if (!match) return token;

  const [, leading, core, trailing] = match;
  if (!core) return null;

  const lowerCore = core.toLowerCase();
  if (SURFACE_PRINT_COLOR_DENYLIST.has(lowerCore)) {
    return null;
  }

  if (core.includes('-') || core.includes('/')) {
    const parts = core.split(/[-/]/).filter((part) => part.length > 0);
    const hasDeniedPart = parts.some((part) => SURFACE_PRINT_COLOR_DENYLIST.has(part.toLowerCase()));
    if (!hasDeniedPart) {
      return token;
    }

    const surviving = parts.filter((part) => !SURFACE_PRINT_COLOR_DENYLIST.has(part.toLowerCase()));
    if (surviving.length === 0) {
      return null;
    }
    return `${leading}${surviving.join('-')}${trailing}`;
  }

  return token;
}

/**
 * Strips surface print, color, and fabric wash terms (including hyphen/slash compounds)
 * while preserving structural sewing hyphenates such as bias-cut, box-pleat, and set-in.
 */
export function sanitizeStructuralNote(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const tokens = raw.trim().split(/\s+/);
  const kept: string[] = [];

  for (const token of tokens) {
    const cleaned = cleanToken(token);
    if (cleaned) {
      kept.push(cleaned);
    }
  }

  return kept
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinWithOptionalNote(segments: string[], note: string): string {
  const cleanedNote = sanitizeStructuralNote(note);
  if (cleanedNote.length > 0) {
    return `${segments.join('; ')}; notes: ${cleanedNote}`;
  }
  return segments.join('; ');
}

/**
 * Deterministically serializes a ConstructionProfileV1 into four print-blind
 * regional structural strings for batched 768-d embedding.
 */
export function serializeCanonicalRegions(profile: ConstructionProfileV1): CanonicalRegionTexts {
  const {
    garment_category,
    substrate_compatibility,
    silhouette,
    bodice_and_neckline,
    sleeves_and_armscye,
    skirt_and_hemline,
    closures_and_details,
    structural_nuance_notes,
  } = profile;

  const dartsList =
    bodice_and_neckline.shaping_darts_seams.length > 0
      ? bodice_and_neckline.shaping_darts_seams.join(', ')
      : 'none_cut_straight';
  const pocketsList =
    skirt_and_hemline.pockets.length > 0 ? skirt_and_hemline.pockets.join(', ') : 'none_visible';

  const bodiceNeckline = joinWithOptionalNote(
    [
      `region: bodice_neckline`,
      `category: ${garment_category}`,
      `substrate: ${substrate_compatibility}`,
      `ease: ${silhouette.ease_level}`,
      `neckline: ${bodice_and_neckline.neckline_type} (${bodice_and_neckline.neckline_depth})`,
      `collar: ${bodice_and_neckline.collar_type}`,
      `shaping: ${dartsList}`,
      `waist_definition: ${bodice_and_neckline.waist_definition}`,
      `back_detail: ${bodice_and_neckline.back_detail}`,
    ],
    structural_nuance_notes.bodice_neckline
  );

  const sleevesArmscye = joinWithOptionalNote(
    [
      `region: sleeves_armscye`,
      `substrate: ${substrate_compatibility}`,
      `armscye: ${sleeves_and_armscye.armscye_construction}`,
      `sleeve_style: ${sleeves_and_armscye.sleeve_style}`,
      `sleeve_length: ${sleeves_and_armscye.sleeve_length}`,
      `cuff_finish: ${sleeves_and_armscye.cuff_finish}`,
    ],
    structural_nuance_notes.sleeves_armscye
  );

  const skirtHemline = skirt_and_hemline.has_skirt_section
    ? joinWithOptionalNote(
        [
          `region: skirt_hemline`,
          `substrate: ${substrate_compatibility}`,
          `waist_definition: ${bodice_and_neckline.waist_definition}`,
          `garment_length: ${silhouette.garment_length}`,
          `skirt_construction: ${skirt_and_hemline.skirt_construction}`,
          `tier_count: ${skirt_and_hemline.tier_count}`,
          `slit_detail: ${skirt_and_hemline.slit_detail}`,
          `hemline_shape: ${skirt_and_hemline.hemline_shape}`,
          `pockets: ${pocketsList}`,
        ],
        structural_nuance_notes.skirt_hemline
      )
    : null;

  const fullSegments = [
    `region: full_silhouette`,
    `category: ${garment_category}`,
    `substrate: ${substrate_compatibility}`,
    `silhouette: ${silhouette.overall_shape}`,
    `ease: ${silhouette.ease_level}`,
    `length: ${silhouette.garment_length}`,
    `neckline: ${bodice_and_neckline.neckline_type} (${bodice_and_neckline.neckline_depth})`,
    `collar: ${bodice_and_neckline.collar_type}`,
    `shaping: ${dartsList}`,
    `waist_definition: ${bodice_and_neckline.waist_definition}`,
    `back_detail: ${bodice_and_neckline.back_detail}`,
    `armscye: ${sleeves_and_armscye.armscye_construction}`,
    `sleeve: ${sleeves_and_armscye.sleeve_style} (${sleeves_and_armscye.sleeve_length}, ${sleeves_and_armscye.cuff_finish})`,
    skirt_and_hemline.has_skirt_section
      ? `skirt: ${skirt_and_hemline.skirt_construction} (tiers: ${skirt_and_hemline.tier_count}, slit: ${skirt_and_hemline.slit_detail}, hem: ${skirt_and_hemline.hemline_shape}, pockets: ${pocketsList})`
      : `skirt: none_top_hem (hem: ${skirt_and_hemline.hemline_shape}, pockets: ${pocketsList})`,
    `closure: ${closures_and_details.primary_closure}`,
    `finish: ${closures_and_details.finish_structure}`,
  ];

  const mergedNotes = [
    structural_nuance_notes.overall_drape_and_proportions,
    structural_nuance_notes.bodice_neckline,
    structural_nuance_notes.sleeves_armscye,
    skirt_and_hemline.has_skirt_section ? structural_nuance_notes.skirt_hemline : '',
  ]
    .map((n) => sanitizeStructuralNote(n))
    .filter((n) => n.length > 0)
    .join('. ');

  const fullSilhouette =
    mergedNotes.length > 0 ? `${fullSegments.join('; ')}; notes: ${mergedNotes}` : fullSegments.join('; ');

  return {
    full_silhouette: fullSilhouette,
    bodice_neckline: bodiceNeckline,
    sleeves_armscye: sleevesArmscye,
    skirt_hemline: skirtHemline,
  };
}
