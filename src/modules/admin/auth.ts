import type { Queryable } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type AdminUser = { userId: string; email: string; role: 'curator' | 'engineer' };

export class AdminAuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'Sign in to the atelier.' : 'This account does not have atelier access.');
  }
}

export async function requireAdminUser(db: Queryable): Promise<AdminUser> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AdminAuthError(401);
  return readMembership(db, data.user.id, false);
}

// Use the identity verified at request entry. Hold membership through the final write.
export function confirmAdminMembership(db: Queryable, verifiedUserId: string): Promise<AdminUser> {
  return readMembership(db, verifiedUserId, true);
}

async function readMembership(db: Queryable, userId: string, lock: boolean): Promise<AdminUser> {
  const { rows: [admin] } = await db.query<{ user_id: string; email: string; role: AdminUser['role'] }>(
    `SELECT user_id, email, role FROM admin_users WHERE user_id = $1 ${lock ? 'FOR SHARE' : ''}`, [userId],
  );
  if (!admin) throw new AdminAuthError(403);
  return { userId: admin.user_id, email: admin.email, role: admin.role };
}
