import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/admin/login') return NextResponse.next();
  const api = request.nextUrl.pathname.startsWith('/api/admin/');
  let forwarded = NextResponse.next({ request });
  const finish = (response: NextResponse) => {
    if (response !== forwarded) {
      for (const cookie of forwarded.cookies.getAll()) response.cookies.set(cookie);
    }
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  };
  function denied(status: 401 | 403 | 503) {
    if (status === 401 && !api) {
      return finish(NextResponse.redirect(new URL('/admin/login', request.url), 303));
    }
    const message = status === 403 ? 'This account does not have atelier access.' :
      status === 401 ? 'Sign in to the atelier.' : 'Atelier access is temporarily unavailable.';
    const code = { 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 503: 'AUTH_UNAVAILABLE' }[status];
    return finish(api ? NextResponse.json({code, message}, {status}) : new NextResponse(message, {status}));
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return denied(503);
  try {
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(updated: Array<{name: string; value: string; options: CookieOptions}>) {
          for (const { name, value } of updated) request.cookies.set(name, value);
          forwarded = NextResponse.next({ request });
          for (const { name, value, options } of updated) forwarded.cookies.set(name, value, options);
        },
      },
    });
    const { data, error } = await client.auth.getUser();
    if (error && (error.status ?? 0) >= 500) return denied(503);
    if (error || !data.user) return denied(401);
    const membership = await client.rpc('is_seamlens_admin');
    if (membership.error) return denied(503);
    return membership.data === true ? finish(forwarded) : denied(403);
  } catch {
    return denied(503);
  }
}

export const config = { matcher: ['/admin/:path*', '/api/admin/:path*'] };
