import { forbidden, unauthorized } from 'next/navigation';
import type { Queryable } from '@/lib/db';
import { AdminAuthError, requireAdminUser } from '@/modules/admin/auth';

export function interruptDeniedAccess(error: unknown) {
  if (error instanceof AdminAuthError) {
    if (error.status === 403) forbidden();
    unauthorized();
  }
}

export async function withAccessBoundary<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    interruptDeniedAccess(error);
    throw error;
  }
}

export function requireAtelierAdmin(db: Queryable) {
  return withAccessBoundary(() => requireAdminUser(db));
}
