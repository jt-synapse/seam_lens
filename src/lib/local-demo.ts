const loopback = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The launcher supplies both URLs; a partial demo configuration must fail before contacting providers. */
export function isLocalDemo(): boolean {
  if (process.env.SEAMLENS_LOCAL_DEMO !== '1') return false;
  const db = URL.canParse(process.env.DATABASE_URL ?? '') ? new URL(process.env.DATABASE_URL!) : null;
  const rawService = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const service = URL.canParse(rawService) ? new URL(rawService) : null;
  if (process.env.VERCEL || !db || !['postgres:', 'postgresql:'].includes(db.protocol) ||
      !loopback.has(db.hostname) || db.pathname !== '/seamlens_demo' || db.search || db.hash ||
      !service || !loopback.has(service.hostname) || service.protocol !== 'http:' ||
      service.href !== service.origin + '/') {
    throw new Error('The local demo requires its isolated loopback database and services. Start it with bun run demo.');
  }
  return true;
}

export function demoMakerDestination(maker: string, product: string, band: string): string {
  if (!isLocalDemo()) throw new Error('Maker previews are available in the local demo.');
  const url = new URL('/maker', process.env.NEXT_PUBLIC_SUPABASE_URL);
  url.search = new URLSearchParams({maker, product, band}).toString();
  return url.href;
}
