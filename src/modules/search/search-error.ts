import type { FocusRegion } from '@/modules/taxonomy/construction-profile';

export type SearchErrorCode =
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'SSRF_BLOCKED'
  | 'HTML_PAGE_URL_UNSUPPORTED'
  | 'NO_GARMENT_DETECTED'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  | 'IMAGE_TOO_LARGE'
  | 'UNSUPPORTED_CATEGORY_V1'
  | 'REGION_UNAVAILABLE';

export class SearchError extends Error {
  constructor(
    readonly code: SearchErrorCode,
    readonly statusCode: number,
    message: string = code,
    readonly availableFocusRegions?: FocusRegion[],
  ) {
    super(message);
    this.name = 'SearchError';
  }
}
