export function buildTrackedDestinationUrl(
  productUrl: string, utmCampaignSlug: string, affiliateQueryParam?: string | null,
): string {
  const url = new URL(productUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new TypeError('Invalid maker product URL.');
  }
  const params = url.searchParams;
  for (const [key, value] of new URLSearchParams(affiliateQueryParam ?? '')) {
    params.set(key, value);
  }
  params.set('utm_source', 'seamlens');
  params.set('utm_medium', 'visual_search');
  params.set('utm_campaign', utmCampaignSlug);
  return url.href;
}
