import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG, ZIP, createEnv, type Env } from './helpers';

let env: Env;
beforeAll(async () => {
  env = await createEnv();
});
afterAll(async () => {
  await env.app.close();
});

const body = (kind: string, filename: string, mime: string, size = 100) => ({
  kind,
  filename,
  mime,
  size,
});

describe('POST /games/:id/uploads', () => {
  it('requires login', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      payload: body('build', 'g.zip', 'application/zip'),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('only lets the creator (or an admin) upload', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      headers: env.as('other'),
      payload: body('build', 'g.zip', 'application/zip'),
    });
    expect(res.statusCode).toBe(403);
    const admin = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      headers: env.as('admin'),
      payload: body('build', 'g.zip', 'application/zip'),
    });
    expect(admin.statusCode).toBe(201);
  });

  it('returns a presigned PUT ticket and records an uploading row', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      headers: env.as('owner'),
      payload: body('screenshot', 'shot.png', 'image/png'),
    });
    expect(res.statusCode).toBe(201);
    const t = res.json();
    expect(t.method).toBe('PUT');
    expect(t.url).toContain('storage.test');
    expect(t.fields).toEqual({});
    expect(t.headers['Content-Type']).toBe('image/png');
    expect(t.media).toMatchObject({ id: t.uploadId, status: 'uploading', kind: 'screenshot' });
    expect(t.media.variants).toEqual({});
  });

  it('returns 404 for an unknown game and 400 for a bad id', async () => {
    const unknown = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/00000000-0000-4000-8000-000000000000/uploads`,
      headers: env.as('owner'),
      payload: body('build', 'g.zip', 'application/zip'),
    });
    expect(unknown.json().error.code).toBe('GAME_NOT_FOUND');
    const bad = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/nope/uploads`,
      headers: env.as('owner'),
      payload: body('build', 'g.zip', 'application/zip'),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid files and avatar/game mix-ups', async () => {
    const send = (url: string, payload: object) =>
      env.app.inject({ method: 'POST', url, headers: env.as('owner'), payload });
    const gameUrl = `/api/v1/games/${env.game}/uploads`;
    expect(
      (await send(gameUrl, body('build', 'g.rar', 'application/x-rar'))).json().error.code,
    ).toBe('INVALID_UPLOAD');
    expect(
      (await send(gameUrl, body('build', 'g.zip', 'application/zip', 3 * 1024 ** 3))).json().error
        .code,
    ).toBe('INVALID_UPLOAD');
    expect((await send(gameUrl, body('avatar', 'a.png', 'image/png'))).json().error.code).toBe(
      'INVALID_UPLOAD',
    );
    expect(
      (await send('/api/v1/users/me/uploads', body('cover', 'a.png', 'image/png'))).json().error
        .code,
    ).toBe('INVALID_UPLOAD');
  });

  it('caps screenshots per game and unfinished uploads per kind', async () => {
    const game = await env.insertGame(env.ids.owner);
    const send = () =>
      env.app.inject({
        method: 'POST',
        url: `/api/v1/games/${game}/uploads`,
        headers: env.as('owner'),
        payload: body('screenshot', 's.png', 'image/png'),
      });
    for (let i = 0; i < 4; i++) expect((await send()).statusCode).toBe(201);
    const fifth = await send();
    expect(fifth.statusCode).toBe(429); // 4 unfinished uploads already
    await env.db.query(`UPDATE media SET status = 'ready' WHERE game_id = $1`, [game]);
    for (let i = 0; i < 4; i++) expect((await send()).statusCode).toBe(201);
    await env.db.query(`UPDATE media SET status = 'ready' WHERE game_id = $1`, [game]);
    for (let i = 0; i < 4; i++) expect((await send()).statusCode).toBe(201);
    await env.db.query(`UPDATE media SET status = 'ready' WHERE game_id = $1`, [game]);
    const over = await send();
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe('UPLOAD_LIMIT_REACHED');
  });

  it('assigns increasing sort_order to screenshots', async () => {
    const game = await env.insertGame(env.ids.owner);
    const a = await env.upload(
      'owner',
      game,
      { kind: 'screenshot', filename: 'a.png', mime: 'image/png' },
      PNG,
    );
    const b = await env.upload(
      'owner',
      game,
      { kind: 'screenshot', filename: 'b.png', mime: 'image/png' },
      PNG,
    );
    expect(a.media).toBeDefined();
    const { rows } = await env.db.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM media WHERE game_id = $1 ORDER BY sort_order`,
      [game],
    );
    expect(rows.map((r) => r.id)).toEqual([a.uploadId, b.uploadId]);
    expect(rows.map((r) => r.sort_order)).toEqual([0, 1]);
  });
});

describe('POST /uploads/:id/complete', () => {
  const complete = (who: string, id: string) =>
    env.app.inject({ method: 'POST', url: `/api/v1/uploads/${id}/complete`, headers: env.as(who) });

  it('moves a build to scanning and enqueues the scan job', async () => {
    const t = await env.upload(
      'owner',
      env.game,
      { kind: 'build', filename: 'g.zip', mime: 'application/zip' },
      ZIP,
    );
    const res = await complete('owner', t.uploadId);
    expect(res.statusCode).toBe(200);
    expect(res.json().media.status).toBe('scanning');
    expect(env.queue.jobs).toContainEqual({ queue: 'media-scan', mediaId: t.uploadId });
    // idempotent
    const again = await complete('owner', t.uploadId);
    expect(again.json().media.status).toBe('scanning');
    expect(env.queue.jobs.filter((j) => j.mediaId === t.uploadId)).toHaveLength(1);
  });

  it('moves images and videos to processing on the right queue', async () => {
    const img = await env.upload(
      'owner',
      env.game,
      { kind: 'cover', filename: 'c.png', mime: 'image/png' },
      PNG,
    );
    expect((await complete('owner', img.uploadId)).json().media.status).toBe('processing');
    expect(env.queue.jobs).toContainEqual({ queue: 'media-image', mediaId: img.uploadId });

    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom'),
      Buffer.alloc(64),
    ]);
    const vid = await env.upload(
      'owner',
      env.game,
      { kind: 'video', filename: 't.mp4', mime: 'video/mp4' },
      mp4,
    );
    expect((await complete('owner', vid.uploadId)).json().media.status).toBe('processing');
    expect(env.queue.jobs).toContainEqual({ queue: 'media-video', mediaId: vid.uploadId });
  });

  it('asks the client to retry when the file has not arrived', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      headers: env.as('owner'),
      payload: body('build', 'late.zip', 'application/zip'),
    });
    const done = await complete('owner', res.json().uploadId);
    expect(done.statusCode).toBe(409);
    expect(done.json().error.code).toBe('UPLOAD_NOT_RECEIVED');
  });

  it('rejects a file whose content does not match its extension and deletes it', async () => {
    const fake = Buffer.from('MZ this is really an exe, not a zip'.padEnd(120, ' '));
    const t = await env.upload(
      'owner',
      env.game,
      { kind: 'build', filename: 'fake.zip', mime: 'application/zip' },
      fake,
    );
    const res = await complete('owner', t.uploadId);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('UPLOAD_REJECTED');
    const row = (
      await env.db.query<{ status: string; variants: { rejectReason: string } }>(
        `SELECT status, variants, storage_key FROM media WHERE id = $1`,
        [t.uploadId],
      )
    ).rows[0]!;
    expect(row.status).toBe('rejected');
    expect(row.variants.rejectReason).toMatch(/does not look like/);
    expect(env.storage.keys('private', `uploads/${t.uploadId}`)).toEqual([]);

    const status = await env.app.inject({
      method: 'GET',
      url: `/api/v1/uploads/${t.uploadId}`,
      headers: env.as('owner'),
    });
    expect(status.json().media).toMatchObject({ status: 'rejected' });
    expect(status.json().media.rejectReason).toMatch(/does not look like/);
  });

  it('rejects a file whose size differs from the announced size', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/api/v1/games/${env.game}/uploads`,
      headers: env.as('owner'),
      payload: body('build', 'big.zip', 'application/zip', 100),
    });
    const t = res.json();
    const key = (
      await env.db.query<{ storage_key: string }>(`SELECT storage_key FROM media WHERE id=$1`, [
        t.uploadId,
      ])
    ).rows[0]!.storage_key;
    env.storage.upload('private', key, Buffer.concat([ZIP, Buffer.alloc(500)]));
    const done = await complete('owner', t.uploadId);
    expect(done.statusCode).toBe(422);
    expect(done.json().error.message).toMatch(/size/);
  });

  it("hides other users' uploads", async () => {
    const t = await env.upload(
      'owner',
      env.game,
      { kind: 'build', filename: 'g.zip', mime: 'application/zip' },
      ZIP,
    );
    expect((await complete('other', t.uploadId)).statusCode).toBe(404);
    const status = await env.app.inject({
      method: 'GET',
      url: `/api/v1/uploads/${t.uploadId}`,
      headers: env.as('other'),
    });
    expect(status.statusCode).toBe(404);
  });
});

describe('DELETE /media/:id', () => {
  it('deletes the row and files, and clears the cover pointer', async () => {
    const t = await env.upload(
      'owner',
      env.game,
      { kind: 'cover', filename: 'c.png', mime: 'image/png' },
      PNG,
    );
    await env.db.query(`UPDATE media SET status='ready' WHERE id=$1`, [t.uploadId]);
    await env.db.query(`UPDATE games SET cover_media_id=$2 WHERE id=$1`, [env.game, t.uploadId]);
    env.storage.upload('public', `media/${t.uploadId}/thumb.webp`, Buffer.from('x'));

    expect(
      (
        await env.app.inject({
          method: 'DELETE',
          url: `/api/v1/media/${t.uploadId}`,
          headers: env.as('other'),
        })
      ).statusCode,
    ).toBe(404);
    const res = await env.app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${t.uploadId}`,
      headers: env.as('owner'),
    });
    expect(res.statusCode).toBe(204);
    expect((await env.db.query(`SELECT 1 FROM media WHERE id=$1`, [t.uploadId])).rows).toHaveLength(
      0,
    );
    expect(
      (
        await env.db.query<{ c: string | null }>(
          `SELECT cover_media_id AS c FROM games WHERE id=$1`,
          [env.game],
        )
      ).rows[0]!.c,
    ).toBeNull();
    expect(env.storage.keys('public', `media/${t.uploadId}`)).toEqual([]);
  });
});

describe('PATCH /games/:id/media/order', () => {
  it('reorders screenshots and validates the list', async () => {
    const game = await env.insertGame(env.ids.owner);
    const ids: string[] = [];
    for (const n of ['a', 'b', 'c']) {
      ids.push(
        (
          await env.upload(
            'owner',
            game,
            { kind: 'screenshot', filename: `${n}.png`, mime: 'image/png' },
            PNG,
          )
        ).uploadId,
      );
    }
    const patch = (who: string, mediaIds: string[]) =>
      env.app.inject({
        method: 'PATCH',
        url: `/api/v1/games/${game}/media/order`,
        headers: env.as(who),
        payload: { mediaIds },
      });

    const reversed = [...ids].reverse();
    const ok = await patch('owner', reversed);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items.map((m: { id: string }) => m.id)).toEqual(reversed);

    expect((await patch('owner', ids.slice(1))).statusCode).toBe(400); // missing one
    expect((await patch('owner', [...ids, ids[0]!])).statusCode).toBe(400); // duplicate
    expect((await patch('other', ids)).statusCode).toBe(403);
  });
});
