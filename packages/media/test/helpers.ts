import Fastify from 'fastify';
import { mediaPlugin } from '../src';
import type { AuthUser } from '../src/core';
import { MemoryQueue, MemoryStorage, openTestDb } from '../src/testing';

export const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(100),
]);

export async function createEnv() {
  const testDb = await openTestDb();
  const db = testDb.db;
  const storage = new MemoryStorage();
  const queue = new MemoryQueue();

  const insertUser = async (username: string, role = 'user') =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO users (username, email, role) VALUES ($1, $2, $3) RETURNING id`,
        [username, `${username}@example.com`, role],
      )
    ).rows[0]!.id;
  const owner = await insertUser('owner');
  const other = await insertUser('other');
  const admin = await insertUser('admin', 'admin');
  const insertGame = async (ownerId: string, status = 'draft', slug = `game-${Math.random()}`) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO games (owner_id, slug, title, status) VALUES ($1, $2, 'A game', $3) RETURNING id`,
        [ownerId, slug, status],
      )
    ).rows[0]!.id;
  const game = await insertGame(owner);

  const users: Record<string, AuthUser> = {
    owner: { id: owner, role: 'user' },
    other: { id: other, role: 'user' },
    admin: { id: admin, role: 'admin' },
  };

  const app = Fastify();
  await app.register(mediaPlugin, {
    prefix: '/api/v1',
    getUser: (req) => users[String(req.headers['x-user'])] ?? null,
    db,
    storage,
    queue,
    config: undefined,
  });
  await app.ready();

  const as = (name: string) => ({ 'x-user': name });
  /** Creates an upload through the API and simulates the browser PUT. */
  async function upload(
    who: string,
    gameId: string | null,
    body: { kind: string; filename: string; mime: string },
    content: Buffer,
  ) {
    const res = await app.inject({
      method: 'POST',
      url: gameId ? `/api/v1/games/${gameId}/uploads` : '/api/v1/users/me/uploads',
      headers: as(who),
      payload: { ...body, size: content.length },
    });
    if (res.statusCode !== 201) throw new Error(`createUpload failed: ${res.body}`);
    const ticket = res.json();
    const media = (
      await db.query<{ storage_key: string }>(`SELECT storage_key FROM media WHERE id=$1`, [
        ticket.uploadId,
      ])
    ).rows[0]!;
    storage.upload('private', media.storage_key, content);
    return ticket as { uploadId: string; media: { id: string } };
  }

  return {
    db,
    close: async () => {
      await app.close();
      await testDb.close();
    },
    app,
    storage,
    queue,
    users,
    ids: { owner, other, admin },
    game,
    insertGame,
    as,
    upload,
  };
}
export type Env = Awaited<ReturnType<typeof createEnv>>;
