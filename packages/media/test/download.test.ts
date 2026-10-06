import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZIP, createEnv, type Env } from './helpers';

let env: Env;
let game: string;
let build: string;

beforeAll(async () => {
  env = await createEnv();
  game = await env.insertGame(env.ids.owner, 'published');
  const t = await env.upload(
    'owner',
    game,
    { kind: 'build', filename: 'My Game.zip', mime: 'application/zip' },
    ZIP,
  );
  build = t.uploadId;
  await env.db.query(`UPDATE media SET status='ready' WHERE id=$1`, [build]);
});
afterAll(async () => {
  await env.app.close();
});

const download = (opts: { who?: string; ip?: string; query?: string; gameId?: string } = {}) =>
  env.app.inject({
    method: 'GET',
    url: `/api/v1/games/${opts.gameId ?? game}/download${opts.query ?? ''}`,
    headers: opts.who ? env.as(opts.who) : {},
    remoteAddress: opts.ip ?? '10.0.0.1',
  });
const count = async (gameId = game) =>
  (
    await env.db.query<{ downloads_count: number }>(
      `SELECT downloads_count FROM games WHERE id=$1`,
      [gameId],
    )
  ).rows[0]!.downloads_count;

describe('GET /games/:id/download', () => {
  it('redirects to a signed URL with the original filename', async () => {
    const res = await download({ ip: '10.0.0.9' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain(`uploads/${build}/original.zip`);
    expect(res.headers.location).toContain('My%20Game.zip');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('counts a user once per 24 hours, and an IP once per 24 hours', async () => {
    const before = await count();
    await download({ who: 'other', ip: '10.1.1.1' });
    await download({ who: 'other', ip: '10.1.1.2' }); // same user, new IP
    expect(await count()).toBe(before + 1);

    await download({ ip: '10.2.2.2' });
    await download({ ip: '10.2.2.2' }); // same anonymous IP
    expect(await count()).toBe(before + 2);

    await download({ ip: '10.2.2.2', who: 'admin' }); // new user, same IP => still counted once per IP
    expect(await count()).toBe(before + 2);
  });

  it('counts again after 24 hours', async () => {
    const before = await count();
    await download({ ip: '10.3.3.3' });
    await env.db.query(`UPDATE downloads SET created_at = now() - interval '25 hours'`);
    await download({ ip: '10.3.3.3' });
    expect(await count()).toBe(before + 2);
  });

  it("does not count the owner's own downloads", async () => {
    const before = await count();
    const res = await download({ who: 'owner', ip: '10.4.4.4' });
    expect(res.statusCode).toBe(302);
    expect(await count()).toBe(before);
  });

  it('hides unpublished games from everyone but the owner', async () => {
    const draft = await env.insertGame(env.ids.owner, 'draft');
    const t = await env.upload(
      'owner',
      draft,
      { kind: 'build', filename: 'd.zip', mime: 'application/zip' },
      ZIP,
    );
    await env.db.query(`UPDATE media SET status='ready' WHERE id=$1`, [t.uploadId]);
    expect((await download({ gameId: draft })).statusCode).toBe(404);
    expect((await download({ gameId: draft, who: 'other' })).statusCode).toBe(404);
    expect((await download({ gameId: draft, who: 'owner' })).statusCode).toBe(302);
  });

  it('needs a ready build', async () => {
    const empty = await env.insertGame(env.ids.owner, 'published');
    const res = await download({ gameId: empty });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BUILD_NOT_AVAILABLE');
  });

  it('can pick a specific build with ?mediaId=', async () => {
    const second = await env.upload(
      'owner',
      game,
      { kind: 'build', filename: 'mac.dmg', mime: 'application/x-apple-diskimage' },
      ZIP,
    );
    await env.db.query(`UPDATE media SET status='ready' WHERE id=$1`, [second.uploadId]);
    const res = await download({ query: `?mediaId=${second.uploadId}` });
    expect(res.headers.location).toContain(`uploads/${second.uploadId}/original.dmg`);
    const pending = await env.upload(
      'owner',
      game,
      { kind: 'build', filename: 'x.zip', mime: 'application/zip' },
      ZIP,
    );
    expect((await download({ query: `?mediaId=${pending.uploadId}` })).statusCode).toBe(404);
  });
});
