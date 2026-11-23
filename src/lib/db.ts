import { Pool } from 'pg';
import { getDatabaseUrl } from './env';

export interface QueryResultLike<R extends Record<string, unknown> = Record<string, unknown>> {
  rows: R[];
  rowCount?: number | null;
  affectedRows?: number;
}

export type Queryable = {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResultLike<R>>;
};

export const VECTOR_DIMENSION = 768;

type TransactionalDb = Queryable & {
  transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T>;
};

type ConnectableDb = Queryable & {
  connect(): Promise<Queryable & { release(): void }>;
};

const globalForDb = globalThis as typeof globalThis & {
  __seamlensDbPool?: Pool;
};

/**
 * Returns the singleton node-postgres Pool configured from DATABASE_URL.
 */
export function getDbPool(): Queryable {
  if (!globalForDb.__seamlensDbPool) {
    globalForDb.__seamlensDbPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForDb.__seamlensDbPool;
}

/**
 * Closes and clears the singleton node-postgres Pool (used by CLI seed/eval scripts).
 */
export async function closeDbPool(): Promise<void> {
  if (globalForDb.__seamlensDbPool) {
    const pool = globalForDb.__seamlensDbPool;
    globalForDb.__seamlensDbPool = undefined;
    await pool.end();
  }
}

function isTransactionalDb(db: Queryable): db is TransactionalDb {
  return (
    'transaction' in db &&
    typeof (db as Partial<TransactionalDb>).transaction === 'function'
  );
}

function isConnectionPool(db: Queryable): db is ConnectableDb {
  return (
    // A checked-out pg client also has connect(), but its caller owns the release.
    !('release' in db) &&
    'connect' in db &&
    typeof (db as Partial<ConnectableDb>).connect === 'function'
  );
}

/**
 * Executes fn inside an atomic database transaction across pg.Pool, pg.PoolClient, or PGlite.
 */
export async function withTransaction<T>(
  db: Queryable,
  fn: (tx: Queryable) => Promise<T>
): Promise<T> {
  if (isTransactionalDb(db)) {
    return db.transaction((tx) => fn(tx));
  }

  const acquiredClient = isConnectionPool(db) ? await db.connect() : undefined;
  const tx = acquiredClient ?? db;

  try {
    await tx.query('BEGIN');
    const result = await fn(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    acquiredClient?.release();
  }
}

/**
 * Validates a 768-d numeric vector and formats it as a pgvector literal string (`[0.1,0.2,...]`).
 */
export function toVectorLiteral(vec: number[] | null): string | null {
  if (vec === null) {
    return null;
  }

  if (!Array.isArray(vec) || vec.length !== VECTOR_DIMENSION) {
    throw new Error(
      `Expected a ${VECTOR_DIMENSION}-dimensional vector, received length ${Array.isArray(vec) ? vec.length : typeof vec}`
    );
  }

  for (let i = 0; i < vec.length; i += 1) {
    if (typeof vec[i] !== 'number' || !Number.isFinite(vec[i])) {
      throw new Error(`Invalid non-finite vector element at index ${i}`);
    }
  }

  return `[${vec.join(',')}]`;
}
