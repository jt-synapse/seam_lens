import { ApiError } from '@google/genai';
import { ConfirmedUnbilledError } from './usage-ledger';

// Google's billing FAQ explicitly excludes 400 and 500 from token charges.
// https://ai.google.dev/gemini-api/docs/billing#am-i-charged-for-failed-requests
// Authentication, access, resource lookup and request size failures happen before inference.
const CONFIRMED_UNBILLED_STATUSES = new Set([400, 401, 403, 404, 413, 500]);

export function rethrowGeminiError(error: unknown): never {
  if (error instanceof ApiError && CONFIRMED_UNBILLED_STATUSES.has(error.status)) {
    throw new ConfirmedUnbilledError(`Gemini returned HTTP ${error.status}`, { cause: error });
  }
  throw error;
}
