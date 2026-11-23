import type { Queryable } from '@/lib/db';
import { getDailyAiBudgetUsd } from '@/lib/env';

export type UsageOperation = 'search_vision' | 'search_embed' | 'ingest_vision' | 'ingest_embed';

type UsageAmounts = {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export class BudgetExceededError extends Error {
  readonly statusCode = 503;

  constructor() {
    super('Daily AI budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

export class DuplicateUsageRequestError extends Error {
  constructor() {
    super('AI usage request ID has already been used');
    this.name = 'DuplicateUsageRequestError';
  }
}

/** Use only when the provider call is known to have incurred no charge. */
export class ConfirmedUnbilledError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfirmedUnbilledError';
  }
}

function assertValidCost(costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new RangeError('AI usage cost must be finite and nonnegative');
  }
}

function assertValidAmounts(amounts: UsageAmounts): void {
  assertValidCost(amounts.estimatedCostUsd);
  for (const tokens of [amounts.inputTokens, amounts.outputTokens]) {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new RangeError('AI usage token counts must be nonnegative safe integers');
    }
  }
}

export async function assertDailyBudgetAvailable(
  db: Queryable,
  dailyCapUsd = getDailyAiBudgetUsd(),
): Promise<void> {
  assertValidCost(dailyCapUsd);
  const { rows } = await db.query<{ available: boolean }>(
    `SELECT public.api_usage_cost_for_day((statement_timestamp() AT TIME ZONE 'UTC')::date)
       < $1::numeric AS available`,
    [dailyCapUsd],
  );
  if (!rows[0]?.available) {
    throw new BudgetExceededError();
  }
}

export async function recordApiUsage(
  db: Queryable,
  delta: { operation: UsageOperation } & UsageAmounts,
): Promise<void> {
  assertValidAmounts(delta);
  await db.query(
    `SELECT public.add_api_usage((statement_timestamp() AT TIME ZONE 'UTC')::date, $1, $2, $3, $4)`,
    [delta.operation, delta.inputTokens, delta.outputTokens, delta.estimatedCostUsd],
  );
}

/** Pass an autocommit connection or pool so the reservation commits before dispatch. */
export async function withBudgetedUsage<T>(
  db: Queryable,
  request: { id: string; operation: UsageOperation; maxCostUsd: number },
  call: () => Promise<{ value: T } & UsageAmounts>,
): Promise<T> {
  const { id, operation, maxCostUsd } = request;
  if (id.trim().length === 0) {
    throw new RangeError('AI usage request ID must be nonempty');
  }
  assertValidCost(maxCostUsd);

  const { rows } = await db.query<{ status: string }>(
    'SELECT public.reserve_api_usage($1, $2, $3, $4) AS status',
    [id, operation, maxCostUsd, getDailyAiBudgetUsd()],
  );
  switch (rows[0]?.status) {
    case 'duplicate':
      throw new DuplicateUsageRequestError();
    case 'exceeded':
      throw new BudgetExceededError();
    case 'reserved':
      break;
    default:
      throw new Error('AI usage reservation returned an unexpected status');
  }

  let result: { value: T } & UsageAmounts;
  try {
    result = await call();
  } catch (error) {
    if (error instanceof ConfirmedUnbilledError) {
      await db.query('SELECT public.finish_api_usage($1, NULL, NULL, NULL)', [id]);
    }
    throw error;
  }

  assertValidAmounts(result);
  const settled = await db.query<{ finished: boolean }>(
    'SELECT public.finish_api_usage($1, $2, $3, $4) AS finished',
    [id, result.inputTokens, result.outputTokens, result.estimatedCostUsd],
  );
  if (!settled.rows[0]?.finished) {
    throw new Error('AI usage reservation was unavailable for settlement');
  }
  return result.value;
}
