/**
 * The only thing the media code needs from a database: run SQL, get rows back.
 * `pg.Pool`, `pg.Client` and PGlite all satisfy this, so tests run on PGlite and
 * production on a pg.Pool.
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Runs a query and returns the first row, or undefined. */
export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
