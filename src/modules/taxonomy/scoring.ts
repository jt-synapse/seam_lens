import type {
  ConstructionProfileV1,
  FocusRegion,
  SubstrateCompatibility,
} from './construction-profile';

const DEFAULT_HYBRID_ALPHA = 0.55;
const TOP_GEOMETRY_WEIGHT_MULTIPLIER = 0.90 / 0.70;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function exactMatch<T>(a: T, b: T): number {
  return a === b ? 1 : 0;
}

/**
 * Checks whether two fabric substrates are compatible (`'both'` matches `'woven'` or `'knit'`).
 */
export function isSubstrateCompatible(
  a: SubstrateCompatibility,
  b: SubstrateCompatibility
): boolean {
  return a === b || a === 'both' || b === 'both';
}

function substrateMatch(a: SubstrateCompatibility, b: SubstrateCompatibility): number {
  return isSubstrateCompatible(a, b) ? 1 : 0;
}

/**
 * Computes set Jaccard similarity on string arrays; empty-vs-empty returns 1.0.
 */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function scoreFullSilhouette(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): number {
  const geometryScore =
    0.2 * exactMatch(query.silhouette.overall_shape, candidate.silhouette.overall_shape) +
    0.14 *
      exactMatch(
        query.bodice_and_neckline.neckline_type,
        candidate.bodice_and_neckline.neckline_type
      ) +
    0.1 *
      jaccardSimilarity(
        query.bodice_and_neckline.shaping_darts_seams,
        candidate.bodice_and_neckline.shaping_darts_seams
      ) +
    0.06 *
      exactMatch(
        query.bodice_and_neckline.waist_definition,
        candidate.bodice_and_neckline.waist_definition
      ) +
    0.1 *
      exactMatch(
        query.sleeves_and_armscye.sleeve_style,
        candidate.sleeves_and_armscye.sleeve_style
      ) +
    0.05 *
      exactMatch(
        query.sleeves_and_armscye.armscye_construction,
        candidate.sleeves_and_armscye.armscye_construction
      ) +
    0.05 *
      exactMatch(
        query.sleeves_and_armscye.sleeve_length,
        candidate.sleeves_and_armscye.sleeve_length
      );
  const materialAndClosureScore =
    0.05 * substrateMatch(query.substrate_compatibility, candidate.substrate_compatibility) +
    0.05 *
      exactMatch(
        query.closures_and_details.primary_closure,
        candidate.closures_and_details.primary_closure
      );

  if (query.garment_category === 'top') {
    return clamp01(geometryScore * TOP_GEOMETRY_WEIGHT_MULTIPLIER + materialAndClosureScore);
  }

  const sameSkirtPresence =
    query.skirt_and_hemline.has_skirt_section === candidate.skirt_and_hemline.has_skirt_section;
  const skirtScore =
    (sameSkirtPresence
      ? 0.12 *
          exactMatch(
            query.skirt_and_hemline.skirt_construction,
            candidate.skirt_and_hemline.skirt_construction
          ) +
        0.04 * exactMatch(query.skirt_and_hemline.tier_count, candidate.skirt_and_hemline.tier_count)
      : 0) +
    0.04 * exactMatch(query.silhouette.garment_length, candidate.silhouette.garment_length);

  return clamp01(geometryScore + materialAndClosureScore + skirtScore);
}

function scoreBodiceNeckline(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): number {
  const score =
    0.35 *
      exactMatch(
        query.bodice_and_neckline.neckline_type,
        candidate.bodice_and_neckline.neckline_type
      ) +
    0.075 *
      exactMatch(
        query.bodice_and_neckline.neckline_depth,
        candidate.bodice_and_neckline.neckline_depth
      ) +
    0.075 *
      exactMatch(query.bodice_and_neckline.collar_type, candidate.bodice_and_neckline.collar_type) +
    0.2 *
      jaccardSimilarity(
        query.bodice_and_neckline.shaping_darts_seams,
        candidate.bodice_and_neckline.shaping_darts_seams
      ) +
    0.15 *
      exactMatch(
        query.bodice_and_neckline.waist_definition,
        candidate.bodice_and_neckline.waist_definition
      ) +
    0.075 * substrateMatch(query.substrate_compatibility, candidate.substrate_compatibility) +
    0.075 * exactMatch(query.silhouette.ease_level, candidate.silhouette.ease_level);

  return clamp01(score);
}

function scoreSleevesArmscye(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): number {
  const score =
    0.35 *
      exactMatch(
        query.sleeves_and_armscye.sleeve_style,
        candidate.sleeves_and_armscye.sleeve_style
      ) +
    0.2 *
      exactMatch(
        query.sleeves_and_armscye.armscye_construction,
        candidate.sleeves_and_armscye.armscye_construction
      ) +
    0.18 *
      exactMatch(
        query.sleeves_and_armscye.sleeve_length,
        candidate.sleeves_and_armscye.sleeve_length
      ) +
    0.12 *
      exactMatch(query.sleeves_and_armscye.cuff_finish, candidate.sleeves_and_armscye.cuff_finish) +
    0.15 * substrateMatch(query.substrate_compatibility, candidate.substrate_compatibility);

  return clamp01(score);
}

function scoreSkirtHemline(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1
): number {
  const sameSkirtPresence =
    query.skirt_and_hemline.has_skirt_section === candidate.skirt_and_hemline.has_skirt_section;

  const score =
    (sameSkirtPresence
      ? 0.35 *
          exactMatch(
            query.skirt_and_hemline.skirt_construction,
            candidate.skirt_and_hemline.skirt_construction
          ) +
        0.15 * exactMatch(query.skirt_and_hemline.tier_count, candidate.skirt_and_hemline.tier_count)
      : 0) +
    0.15 * exactMatch(query.silhouette.garment_length, candidate.silhouette.garment_length) +
    0.06 * exactMatch(query.skirt_and_hemline.slit_detail, candidate.skirt_and_hemline.slit_detail) +
    0.06 *
      exactMatch(query.skirt_and_hemline.hemline_shape, candidate.skirt_and_hemline.hemline_shape) +
    0.08 * jaccardSimilarity(query.skirt_and_hemline.pockets, candidate.skirt_and_hemline.pockets) +
    0.075 * substrateMatch(query.substrate_compatibility, candidate.substrate_compatibility) +
    0.075 *
      exactMatch(
        query.bodice_and_neckline.waist_definition,
        candidate.bodice_and_neckline.waist_definition
      );

  return clamp01(score);
}

/**
 * Computes the deterministic region-weighted structural similarity score in [0, 1]
 * between a query and candidate ConstructionProfileV1 per Spec §5.4.3.
 */
export function computeStructuralScore(
  query: ConstructionProfileV1,
  candidate: ConstructionProfileV1,
  region: FocusRegion
): number {
  switch (region) {
    case 'full_silhouette':
      return scoreFullSilhouette(query, candidate);
    case 'bodice_neckline':
      return scoreBodiceNeckline(query, candidate);
    case 'sleeves_armscye':
      return scoreSleevesArmscye(query, candidate);
    case 'skirt_hemline':
      return scoreSkirtHemline(query, candidate);
  }
}

/**
 * Combines vector cosine similarity and structural score with weight alpha (default 0.55),
 * clamped to [0, 1].
 */
export function combineHybridScore(
  vectorCosineSim: number,
  structuralScore: number,
  alpha = DEFAULT_HYBRID_ALPHA
): number {
  const safeAlpha = clamp01(alpha);
  const vec = clamp01(vectorCosineSim);
  const struct = clamp01(structuralScore);
  return clamp01(safeAlpha * vec + (1 - safeAlpha) * struct);
}
