import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  getOptionalPublicSupabaseUrl,
  getSupabasePublicConfig,
  getSupabaseServiceConfig,
} from '@/lib/env';
import legacySyntheticMediaPaths from './legacy-synthetic-media-paths.json';

// These exact paths were stored by the original seed before fixtures used root-relative URLs.
const legacySyntheticMediaPathSet = new Set(legacySyntheticMediaPaths);

/**
 * Creates a cookie-bound Supabase SSR client for Server Components, Route Handlers, and Server Actions.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = getSupabasePublicConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot mutate response cookies directly; middleware refreshes sessions.
        }
      },
    },
  });
}

/**
 * Creates a server-only Supabase service-role client (bypasses RLS for ingestion and Storage uploads).
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const { url, serviceRoleKey } = getSupabaseServiceConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Resolves bundled fixtures locally and Storage object paths against the configured Supabase URL.
 */
export function resolveCatalogMediaUrl(storagePath: string | null): string | null {
  if (!storagePath) {
    return null;
  }
  if (
    storagePath.startsWith('https://') ||
    storagePath.startsWith('http://') ||
    storagePath.startsWith('/')
  ) {
    return storagePath;
  }

  if (legacySyntheticMediaPathSet.has(storagePath)) {
    return `/${storagePath}`;
  }

  const supabaseUrl = getOptionalPublicSupabaseUrl();
  if (!supabaseUrl) {
    return `/${storagePath}`;
  }

  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${storagePath}`;
}
