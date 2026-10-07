import { randomBytes } from 'node:crypto';
import type { Db } from '../db';
import { TEST_SCHEMA_SQL } from './schema';

export interface TestDb {
  db: Db;
  /** Empties every table. */
  reset(): Promise<void>;
  close(): Promise<void>;
  /** Which engine is behind `db`. */
  engine: 'postgres' | 'pglite';
}

const TABLES =
  'users, games, media, game_likes, reviews, comments, comment_likes, karma_events, downloads, game_scores';

/**
 * A database with the test schema. With `TEST_DATABASE_URL` set (CI does) it uses that real
 * PostgreSQL server, inside a throwaway schema so existing data is never touched; otherwise
 * it falls back to PGlite (PostgreSQL compiled to WASM), which needs no server.
 */
export async function openTestDb(): Promise<TestDb> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const { Pool } = await import('pg');
    const schema = `ht_test_${randomBytes(6).toString('hex')}`;
    const admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 4 });
    await pool.query(TEST_SCHEMA_SQL);
    return {
      db: pool,
      engine: 'postgres',
      reset: async () => void (await pool.query(`TRUNCATE ${TABLES} CASCADE`)),
      close: async () => {
        await pool.query(`DROP SCHEMA ${schema} CASCADE`);
        await pool.end();
      },
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  await pg.exec(TEST_SCHEMA_SQL);
  return {
    db: pg,
    engine: 'pglite',
    reset: async () => void (await pg.exec(`TRUNCATE ${TABLES} CASCADE`)),
    close: () => pg.close(),
  };
}
