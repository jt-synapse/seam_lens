import { after, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbPool } from '@/lib/db';
import { buildTrackedDestinationUrl } from '@/modules/catalog/outbound-url';
import { FocusRegionSchema } from '@/modules/taxonomy/construction-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuid = z.string().uuid();
const uncached = { 'Cache-Control': 'private, no-store' };
const unavailable = () => new Response('Pattern unavailable.', { status: 404, headers: uncached });

export async function GET(request: Request, context: { params: Promise<{ pattern_id: string }> }) {
  const { pattern_id: patternId } = await context.params;
  if (!uuid.safeParse(patternId).success) return unavailable();
  const params = new URL(request.url).searchParams;
  const band = uuid.safeParse(params.get('band')).data ?? null;
  const view = uuid.safeParse(params.get('v')).data ?? null;
  const session = uuid.safeParse(params.get('q')).data ?? null;
  const focus = FocusRegionSchema.safeParse(params.get('region')).data ?? null;
  const rank = z.coerce.number().int().min(1).max(18).safeParse(params.get('pos')).data ?? null;
  const db = getDbPool();
  const { rows: [target] } = await db.query<{
    band_id: string; maker_id: string; view_id: string | null; product_url: string;
    utm_campaign_slug: string; affiliate_query_param: string | null;
  }>(
    `SELECT b.id AS band_id, p.maker_id, v.id AS view_id, b.product_url,
            m.utm_campaign_slug, m.affiliate_query_param
     FROM patterns p JOIN makers m ON m.id = p.maker_id
     JOIN pattern_size_bands b ON b.pattern_id = p.id AND b.maker_id = p.maker_id
     LEFT JOIN pattern_views v ON v.pattern_id = p.id AND v.id = $3::uuid
     WHERE p.id = $1 AND p.status = 'published' AND m.vetted_status = 'approved'
       AND (b.id = $2::uuid OR b.is_default)
     ORDER BY (b.id = $2::uuid) DESC NULLS LAST, b.id LIMIT 1`,
    [patternId, band, view],
  );
  if (!target) return unavailable();
  let destination: string;
  try {
    destination = buildTrackedDestinationUrl(target.product_url, target.utm_campaign_slug, target.affiliate_query_param);
  } catch {
    return unavailable();
  }
  after(async () => {
    await db.query(
      `INSERT INTO outbound_clicks (pattern_id, size_band_id, pattern_view_id, maker_id,
                                    query_session_id, rank_position, focus_region, destination_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [patternId, target.band_id, target.view_id, target.maker_id, session, rank, focus, destination],
    );
  });
  return NextResponse.redirect(destination, { status: 302, headers: uncached });
}
