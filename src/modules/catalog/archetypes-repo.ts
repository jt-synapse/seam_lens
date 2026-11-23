import { withTransaction, type Queryable } from '@/lib/db';
import { resolveCatalogMediaUrl } from '@/lib/supabase/server';
import { serializeCanonicalRegions } from '@/modules/taxonomy/canonical-serializer';
import type { ConstructionProfileV1, FocusRegion } from '@/modules/taxonomy/construction-profile';

export type CuratedArchetypeSummary = {
  slug: string;
  title: string;
  caption: string;
  imageUrl: string;
  defaultFocusRegion: FocusRegion;
};

export async function listActiveArchetypes(db: Queryable): Promise<CuratedArchetypeSummary[]> {
  const { rows } = await db.query<CuratedArchetypeSummary>(
    `SELECT slug, title, caption, image_path AS "imageUrl", default_focus_region AS "defaultFocusRegion"
     FROM curated_archetypes WHERE active ORDER BY sort_order, slug`,
  );
  return rows.map(row => ({ ...row, imageUrl: resolveCatalogMediaUrl(row.imageUrl) ?? row.imageUrl }));
}

export class ArchetypeUnavailableError extends Error {}

export async function startArchetypeSession(db: Queryable, slug: string) {
  return withTransaction(db, async tx => {
    const { rows: [source] } = await tx.query<{ profile: ConstructionProfileV1; focus: FocusRegion }>(
      `SELECT extracted_profile AS profile, default_focus_region AS focus
       FROM curated_archetypes WHERE active AND slug = $1 FOR SHARE`, [slug],
    );
    if (!source) throw new ArchetypeUnavailableError('This sample is no longer available.');
    const canonical = serializeCanonicalRegions(source.profile);
    const { rows: [session] } = await tx.query<{ id: string }>(
      `INSERT INTO query_sessions (image_sha256, query_status, extracted_profile, canonical_texts,
                                   vec_full, vec_bodice, vec_sleeves, vec_skirt)
       SELECT 'archetype:' || slug, 'ok', extracted_profile, $2::jsonb,
              vec_full, vec_bodice, vec_sleeves, vec_skirt
       FROM curated_archetypes WHERE active AND slug = $1 RETURNING id`, [slug, JSON.stringify(canonical)],
    );
    return { id: session.id, defaultFocusRegion: source.focus };
  });
}

export async function createSessionFromArchetype(db: Queryable, slug: string): Promise<string> {
  return (await startArchetypeSession(db, slug)).id;
}
