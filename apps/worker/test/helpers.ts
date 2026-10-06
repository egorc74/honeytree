import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { MemoryQueue, MemoryStorage, TEST_SCHEMA_SQL } from '@honeytree/media/testing';
import type { MediaKind } from '@honeytree/media/core';
import type { Scanner } from '../src/clamav';
import type { WorkerContext } from '../src/context';
import { silentLogger } from '../src/log';

export const cleanScanner: Scanner = { scan: async () => ({ clean: true }) };

// Booting PGlite takes seconds, so every test file shares one instance and starts from empty tables.
let shared: Promise<PGlite> | undefined;
async function freshDb() {
  shared ??= (async () => {
    const d = new PGlite();
    await d.exec(TEST_SCHEMA_SQL);
    return d;
  })();
  const d = await shared;
  await d.exec(
    'TRUNCATE users, games, media, game_likes, reviews, comments, comment_likes, karma_events, downloads, game_scores CASCADE',
  );
  return d;
}

export async function createWorkerEnv(scanner: Scanner = cleanScanner) {
  const db = await freshDb();
  const tmpDir = await mkdtemp(join(tmpdir(), 'ht-test-'));
  const storage = new MemoryStorage();
  const queue = new MemoryQueue();
  const ctx: WorkerContext = {
    db,
    storage,
    queue,
    scanner,
    log: silentLogger,
    tmpDir,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    now: () => new Date(),
  };

  const userId = (
    await db.query<{ id: string }>(
      `INSERT INTO users (username, email) VALUES ('creator', 'c@example.com') RETURNING id`,
    )
  ).rows[0]!.id;
  const gameId = (
    await db.query<{ id: string }>(
      `INSERT INTO games (owner_id, slug, title, status) VALUES ($1, 'g', 'G', 'published') RETURNING id`,
      [userId],
    )
  ).rows[0]!.id;

  /** Inserts a media row as it looks right after `POST /uploads/:id/complete`. */
  async function addMedia(
    kind: MediaKind,
    filename: string,
    content: Uint8Array,
    status: 'scanning' | 'processing' | 'uploading' = kind === 'build' ? 'scanning' : 'processing',
    forGame: string | null = kind === 'avatar' ? null : gameId,
  ) {
    const id = crypto.randomUUID();
    const key = `uploads/${id}/${filename}`;
    storage.upload('private', key, content);
    await db.query(
      `INSERT INTO media (id, game_id, owner_id, kind, storage_key, original_name, mime, size_bytes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'x/y', $7, $8)`,
      [id, forGame, userId, kind, key, filename, content.length, status],
    );
    return id;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = async (id: string): Promise<any> =>
    (await db.query(`SELECT * FROM media WHERE id=$1`, [id])).rows[0];

  return {
    db,
    ctx,
    storage,
    queue,
    userId,
    gameId,
    addMedia,
    row,
    cleanup: () => rm(tmpDir, { recursive: true, force: true }),
  };
}
export type WorkerEnv = Awaited<ReturnType<typeof createWorkerEnv>>;
