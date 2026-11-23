import { withTransaction, type Queryable } from '@/lib/db';
import { resolveCatalogMediaUrl } from '@/lib/supabase/server';
import { buildExplanationChips, type MatchChip } from '@/modules/taxonomy/chips';
import {
  type ConstructionProfileV1,
  type DeliveryFormat,
  type FocusRegion,
  type GarmentCategory,
  type SkillLevel,
  type SubstrateCompatibility,
} from '@/modules/taxonomy/construction-profile';
import { combineHybridScore, computeStructuralScore } from '@/modules/taxonomy/scoring';
import { SearchError } from './search-error';

export type SearchFilters = {
  substrate?: 'woven' | 'knit' | null;
  userBustIn?: number | null;
  userHipIn?: number | null;
  formats?: DeliveryFormat[];
  skills?: SkillLevel[];
};

export type RankedPatternCard = {
  patternId: string;
  viewId: string;
  viewLabel: string;
  secondaryViewCount: number;
  garmentCategory: GarmentCategory;
  title: string;
  makerName: string;
  coverImageUrl: string;
  flatFrontImageUrl: string | null;
  flatBackImageUrl: string | null;
  matchedSizeBandId: string;
  priceCents: number | null;
  currency: string;
  bustRangeIn: [number, number];
  hipRangeIn: [number | null, number | null];
  designerSizeLabel: string;
  substrateType: SubstrateCompatibility;
  formats: DeliveryFormat[];
  skillLevel: SkillLevel;
  totalScore: number;
  matchedChips: MatchChip[];
  diffChips: MatchChip[];
};

export type CandidateReranker = {
  rerank(query: ConstructionProfileV1, focusRegion: FocusRegion, candidates: RankedPatternCard[]): Promise<RankedPatternCard[]>;
};

export const noopCandidateReranker: CandidateReranker = {
  async rerank(_query, _focusRegion, candidates) {
    return candidates;
  },
};

type QueryStatus = 'ok' | 'low_visibility_partial' | 'unsupported_category_v1';
type SearchSource = 'upload' | 'url' | 'archetype' | 'filter_refinement';
type RelaxationHint = { facet: keyof SearchFilters; resultCount: number; label: string };
type SessionRow = {
  query_status: QueryStatus;
  extracted_profile: ConstructionProfileV1;
  warnings: string[];
  has_crop: boolean;
  vector: string | null;
};
type CandidateRow = {
  pattern_id: string;
  view_id: string;
  view_label: string;
  secondary_view_count: number;
  garment_category: GarmentCategory;
  title: string;
  maker_name: string;
  cover_image_path: string;
  flat_front_image_path: string | null;
  flat_back_image_path: string | null;
  band_id: string;
  price_cents: number | null;
  currency: string;
  bust_min: number;
  bust_max: number;
  hip_min: number | null;
  hip_max: number | null;
  designer_size_label: string;
  substrate_type: SubstrateCompatibility;
  formats: DeliveryFormat[];
  skill_level: SkillLevel;
  construction_profile: ConstructionProfileV1;
  distance: number;
};

const vectorColumn = {
  full_silhouette: 'vec_full',
  bodice_neckline: 'vec_bodice',
  sleeves_armscye: 'vec_sleeves',
  skirt_hemline: 'vec_skirt',
} as const satisfies Record<FocusRegion, string>;

const facetLabels = {
  substrate: 'fabric',
  userBustIn: 'bust',
  userHipIn: 'hip',
  formats: 'format',
  skills: 'skill level',
} as const satisfies Record<keyof SearchFilters, string>;

const upperBodyRegions: readonly FocusRegion[] = ['bodice_neckline', 'sleeves_armscye'];

const bandPredicate = `
  band.pattern_id = p.id
  AND ($1::numeric IS NULL OR $1 BETWEEN band.bust_min_in AND band.bust_max_in)
  AND ($2::numeric IS NULL OR $2 BETWEEN band.hip_min_in AND band.hip_max_in
       OR (p.garment_category = 'top' AND band.hip_min_in IS NULL AND band.hip_max_in IS NULL))
`;

// The only interpolated identifier comes from the focus-region column allowlist.
function eligibleViews(column: (typeof vectorColumn)[FocusRegion]) {
  return `
    FROM pattern_views v
    JOIN patterns p ON p.id = v.pattern_id
    JOIN makers m ON m.id = p.maker_id
    WHERE p.status = 'published' AND m.vetted_status = 'approved'
      AND v.${column} IS NOT NULL
      AND ($6::text IS NULL OR v.garment_category = $6)
      AND ($3::text IS NULL OR p.substrate_type IN ($3, 'both'))
      AND ($4::text[] IS NULL OR p.formats && $4)
      AND ($5::text[] IS NULL OR p.skill_level = ANY($5))
      AND EXISTS (SELECT 1 FROM pattern_size_bands band WHERE ${bandPredicate})
  `;
}

function filterParameters(filters: SearchFilters, category: GarmentCategory | null) {
  return [
    filters.userBustIn ?? null,
    filters.userHipIn ?? null,
    filters.substrate ?? null,
    filters.formats?.length ? filters.formats : null,
    filters.skills?.length ? filters.skills : null,
    category,
  ];
}

function compareIds(first: string, second: string) {
  return first < second ? -1 : Number(first > second);
}

async function relaxationHints(
  db: Queryable,
  eligibleSql: string,
  filters: SearchFilters,
  category: GarmentCategory | null,
): Promise<RelaxationHint[]> {
  const hints: RelaxationHint[] = [];
  const facetActive = {
    substrate: filters.substrate != null,
    userBustIn: filters.userBustIn != null,
    userHipIn: filters.userHipIn != null,
    formats: Boolean(filters.formats?.length),
    skills: Boolean(filters.skills?.length),
  } satisfies Record<keyof SearchFilters, boolean>;
  for (const facet of Object.keys(facetActive) as (keyof SearchFilters)[]) {
    if (!facetActive[facet]) continue;
    const { rows: [{ count }] } = await db.query<{ count: number }>(
      `SELECT count(DISTINCT p.id)::int AS count ${eligibleSql}`,
      filterParameters({ ...filters, [facet]: undefined }, category),
    );
    if (count > 0) {
      hints.push({
        facet,
        resultCount: count,
        label: `${count} ${count === 1 ? 'match' : 'matches'} without the ${facetLabels[facet]} filter`,
      });
    }
  }
  return hints;
}

function toCard(row: CandidateRow, profile: ConstructionProfileV1, focusRegion: FocusRegion): RankedPatternCard {
  const totalScore = combineHybridScore(1 - row.distance, computeStructuralScore(profile, row.construction_profile, focusRegion));
  const { matched, diffs } = buildExplanationChips(profile, row.construction_profile, focusRegion, totalScore);
  return {
    patternId: row.pattern_id,
    viewId: row.view_id,
    viewLabel: row.view_label,
    secondaryViewCount: row.secondary_view_count,
    garmentCategory: row.garment_category,
    title: row.title,
    makerName: row.maker_name,
    coverImageUrl: resolveCatalogMediaUrl(row.cover_image_path) ?? row.cover_image_path,
    flatFrontImageUrl: resolveCatalogMediaUrl(row.flat_front_image_path),
    flatBackImageUrl: resolveCatalogMediaUrl(row.flat_back_image_path),
    matchedSizeBandId: row.band_id,
    priceCents: row.price_cents,
    currency: row.currency,
    bustRangeIn: [row.bust_min, row.bust_max],
    hipRangeIn: [row.hip_min, row.hip_max],
    designerSizeLabel: row.designer_size_label,
    substrateType: row.substrate_type,
    formats: row.formats,
    skillLevel: row.skill_level,
    totalScore,
    matchedChips: matched,
    diffChips: diffs,
  };
}

export async function executeSessionSearch(
  db: Queryable,
  querySessionId: string,
  focusRegion: FocusRegion,
  filters: SearchFilters,
  reranker: CandidateReranker = noopCandidateReranker,
): Promise<{
  querySessionId: string;
  queryStatus: QueryStatus;
  extractedProfile: ConstructionProfileV1;
  warnings: string[];
  results: RankedPatternCard[];
  relaxationHints: RelaxationHint[];
}> {
  if (!Object.hasOwn(vectorColumn, focusRegion)) {
    throw new SearchError('INVALID_INPUT', 400, 'Unknown focus region.');
  }
  const column = vectorColumn[focusRegion];

  const { response, cards } = await withTransaction(db, async (tx) => {
    await tx.query('SET LOCAL hnsw.iterative_scan = relaxed_order');
    const { rows: [session] } = await tx.query<SessionRow>(
      `SELECT query_status, extracted_profile, warnings,
              crop_box IS NOT NULL AS has_crop, ${column}::text AS vector
       FROM query_sessions WHERE id = $1 AND expires_at > now()`,
      [querySessionId],
    );
    if (!session) throw new SearchError('SESSION_EXPIRED', 404, 'This search session has expired.');

    const profile = session.extracted_profile;
    const response = {
      querySessionId,
      queryStatus: session.query_status,
      extractedProfile: profile,
      warnings: session.warnings,
      relaxationHints: [] as RelaxationHint[],
    };

    if (focusRegion === 'skirt_hemline' && (
      session.vector === null || !profile.skirt_and_hemline.has_skirt_section ||
      session.query_status === 'unsupported_category_v1'
    )) {
      const available = session.query_status === 'unsupported_category_v1'
        ? [...upperBodyRegions]
        : ['full_silhouette' as const, ...upperBodyRegions];
      throw new SearchError('REGION_UNAVAILABLE', 422, 'Choose a focus with visible garment detail.', available);
    }

    // An out-of-scope garment can still offer a part-focus refinement in the same session.
    if (session.query_status === 'unsupported_category_v1' && focusRegion === 'full_silhouette') {
      return { response, cards: [] };
    }

    const ambiguousCategory = session.has_crop || session.query_status === 'low_visibility_partial'
      || session.warnings.includes('cropped_or_ambiguous_lower_frame');
    const category = focusRegion === 'full_silhouette' && !ambiguousCategory ? profile.garment_category : null;
    const eligibleSql = eligibleViews(column);
    const { rows } = await tx.query<CandidateRow>(
      `WITH nearest AS MATERIALIZED (
        SELECT id, pattern_id, distance FROM (
          SELECT v.id, v.pattern_id, v.${column} <=> $7::vector AS distance
          ${eligibleSql}
          ORDER BY distance
          FETCH FIRST 40 ROWS WITH TIES
        ) boundary
        ORDER BY distance, id
        LIMIT 40
      )
      SELECT
        v.id AS view_id, v.view_label, v.garment_category, v.pattern_id, v.construction_profile,
        v.cover_image_path, v.flat_front_image_path, v.flat_back_image_path, nearest.distance,
        p.title, p.substrate_type, p.formats, p.skill_level, m.name AS maker_name,
        selected.id AS band_id, selected.price_cents, selected.currency,
        ranges.bust_min, ranges.bust_max, ranges.hip_min, ranges.hip_max,
        COALESCE(ranges.designer_size_label, selected.band_label) AS designer_size_label,
        (SELECT count(*)::int - 1 FROM pattern_views secondary WHERE secondary.pattern_id = p.id) AS secondary_view_count
      FROM nearest
      JOIN pattern_views v ON v.id = nearest.id
      JOIN patterns p ON p.id = nearest.pattern_id
      JOIN makers m ON m.id = p.maker_id
      CROSS JOIN LATERAL (
        SELECT band.id, band.price_cents, band.currency, band.band_label
        FROM pattern_size_bands band
        WHERE ${bandPredicate}
        ORDER BY band.is_default DESC, band.id
        LIMIT 1
      ) selected
      CROSS JOIN LATERAL (
        SELECT min(bust_min_in)::float8 AS bust_min, max(bust_max_in)::float8 AS bust_max,
               min(hip_min_in)::float8 AS hip_min, max(hip_max_in)::float8 AS hip_max,
               string_agg(COALESCE(designer_size_label, band_label), ' / ' ORDER BY is_default DESC, id) AS designer_size_label
        FROM pattern_size_bands WHERE pattern_id = p.id
      ) ranges`,
      [...filterParameters(filters, category), session.vector],
    );

    if (rows.length === 0) {
      response.relaxationHints = await relaxationHints(tx, eligibleSql, filters, category);
    }
    return { response, cards: rows.map((row) => toCard(row, profile, focusRegion)) };
  });

  cards.sort((first, second) => second.totalScore - first.totalScore ||
    compareIds(first.patternId, second.patternId) || compareIds(first.viewId, second.viewId));

  const seenPatterns = new Set<string>();
  const ranked = cards.length === 0 ? [] : await reranker.rerank(response.extractedProfile, focusRegion, cards);
  const results: RankedPatternCard[] = [];
  for (const card of ranked) {
    if (seenPatterns.has(card.patternId)) continue;
    seenPatterns.add(card.patternId);
    results.push(card);
    if (results.length === 18) break;
  }
  return { ...response, results };
}

export type SearchExecutionResult = Awaited<ReturnType<typeof executeSessionSearch>>;

export async function executeLoggedSessionSearch(
  db: Queryable,
  querySessionId: string,
  focusRegion: FocusRegion,
  filters: SearchFilters,
  sourceType: SearchSource,
  startedAt = performance.now(),
  reranker?: CandidateReranker,
): Promise<SearchExecutionResult> {
  const result = await executeSessionSearch(db, querySessionId, focusRegion, filters, reranker);
  await db.query(
    `INSERT INTO search_events (query_session_id, source_type, focus_region, filters_applied,
                                result_count, top_pattern_ids, latency_ms)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid[], $7)`,
    [querySessionId, sourceType, focusRegion, JSON.stringify(filters), result.results.length,
      result.results.map(({ patternId }) => patternId), Math.round(performance.now() - startedAt)],
  );
  return result;
}
