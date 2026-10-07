import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeGameScores } from '@honeytree/ranking';
import { computeScores, toMetrics, METRICS_SQL } from '../src/processors/scores';
import { createWorkerEnv, type WorkerEnv } from './helpers';

const NOW = new Date('2026-10-06T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000);

let env: WorkerEnv;
beforeEach(async () => {
  env = await createWorkerEnv();
  env.ctx.now = () => NOW;
});
afterEach(() => env.cleanup());

async function user(name: string) {
  return (
    await env.db.query<{ id: string }>(
      `INSERT INTO users (username, email) VALUES ($1, $2) RETURNING id`,
      [name, `${name}@example.com`],
    )
  ).rows[0]!.id;
}
async function game(
  ownerId: string,
  slug: string,
  publishedHoursAgo: number,
  status = 'published',
) {
  return (
    await env.db.query<{ id: string }>(
      `INSERT INTO games (owner_id, slug, title, status, published_at, created_at)
       VALUES ($1, $2, $2, $3, $4, $4) RETURNING id`,
      [ownerId, slug, status, ago(publishedHoursAgo)],
    )
  ).rows[0]!.id;
}
const like = (u: string, g: string, h: number) =>
  env.db.query(`INSERT INTO game_likes (user_id, game_id, created_at) VALUES ($1,$2,$3)`, [
    u,
    g,
    ago(h),
  ]);
const review = (u: string, g: string, rating: number, h: number) =>
  env.db.query(`INSERT INTO reviews (user_id, game_id, rating, created_at) VALUES ($1,$2,$3,$4)`, [
    u,
    g,
    rating,
    ago(h),
  ]);
const comment = (u: string, g: string, h: number, deleted = false) =>
  env.db.query(
    `INSERT INTO comments (user_id, game_id, created_at, deleted_at) VALUES ($1,$2,$3,$4)`,
    [u, g, ago(h), deleted ? ago(h) : null],
  );
const download = (u: string | null, ip: string, g: string, h: number) =>
  env.db.query(
    `INSERT INTO downloads (user_id, ip_hash, game_id, created_at) VALUES ($1,$2,$3,$4)`,
    [u, ip, g, ago(h)],
  );
const scoreRow = async (gameId: string) =>
  (
    await env.db.query<Record<string, number>>(`SELECT * FROM game_scores WHERE game_id=$1`, [
      gameId,
    ])
  ).rows[0];

describe('computeScores', () => {
  it('counts unique, non-owner engagement per window and writes game_scores', async () => {
    const owner = await user('owner');
    const [a, b, c] = [await user('a'), await user('b'), await user('c')];
    const g = await game(owner, 'hit', 3 * 24); // published 3 days ago

    // last 24h: a likes, b likes, owner likes (excluded), a reviews, b comments twice (one user),
    // c's comment was deleted (excluded), anonymous + c download from distinct sources, same IP twice
    await like(a, g, 2);
    await like(b, g, 5);
    await like(owner, g, 1);
    await review(a, g, 5, 3);
    await comment(b, g, 4);
    await comment(b, g, 6);
    await comment(c, g, 7, true);
    await download(c, 'ip-c', g, 1);
    await download(null, 'ip-x', g, 2);
    await download(null, 'ip-x', g, 10);
    // earlier in the week (not in 24h, in the 7d window and the 8d..1d baseline)
    await like(c, g, 30);
    await download(null, 'ip-y', g, 50);
    // older than 8 days: counted only in all-time totals
    await like(await user('old'), g, 24 * 20);

    const result = await computeScores(env.ctx);
    expect(result).toEqual({ games: 1, removed: 0 });
    const row = (await scoreRow(g))!;

    // E24h = 3 likes(a,b → 2) → 6; reviews 1 → 4; comments 1 distinct user → 2; downloads c + ip-x → 2  = 14
    expect(row.engagement_24h).toBe(14);
    // 7d adds like(c) 3 and download ip-y 1  = 18
    expect(row.engagement_7d).toBe(18);
    expect(row.fresh_score).toBeCloseTo(1 / 4); // age 3 days
    expect(row.rising_score).toBeGreaterThan(0);
    expect(row.loved_score).toBeGreaterThan(0);
    expect(row.computed_at).toBeInstanceOf(Date);
  });

  it('agrees with the pure ranking functions', async () => {
    const owner = await user('owner');
    const fans = await Promise.all(['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map(user));
    const g = await game(owner, 'g', 20);
    for (const f of fans) {
      await like(f, g, 2);
      await review(f, g, 4, 1);
    }
    await computeScores(env.ctx);
    const { rows } = await env.db.query(METRICS_SQL, [NOW]);
    const [expected] = computeGameScores(rows.map((r) => toMetrics(r as never)));
    const row = (await scoreRow(g))!;
    expect(row.rising_score).toBeCloseTo(expected!.risingScore);
    expect(row.loved_score).toBeCloseTo(expected!.lovedScore);
    expect(row.fresh_score).toBeCloseTo(expected!.freshScore);
    expect(row.engagement_24h).toBe(6 * 3 + 6 * 4);
  });

  it('boosts fresh score for complete listings and ignores media that is not ready', async () => {
    const owner = await user('owner');
    const plain = await game(owner, 'plain', 24);
    const full = await game(owner, 'full', 24);
    const addMedia = (g: string, kind: string, status = 'ready') =>
      env.db.query(
        `INSERT INTO media (game_id, owner_id, kind, storage_key, original_name, mime, size_bytes, status) VALUES ($1,$2,$3,'k','n','m',1,$4)`,
        [g, owner, kind, status],
      );
    await addMedia(full, 'video');
    for (let i = 0; i < 3; i++) await addMedia(full, 'screenshot');
    await addMedia(plain, 'video', 'processing');
    for (let i = 0; i < 3; i++) await addMedia(plain, 'screenshot', 'rejected');
    await computeScores(env.ctx);
    expect((await scoreRow(plain))!.fresh_score).toBeCloseTo(0.5);
    expect((await scoreRow(full))!.fresh_score).toBeCloseTo(0.6);
  });

  it('only scores published games and removes scores of games that stop being published', async () => {
    const owner = await user('owner');
    const live = await game(owner, 'live', 10);
    const draft = await game(owner, 'draft', 10, 'draft');
    const future = await game(owner, 'future', -5); // published_at in the future
    await computeScores(env.ctx);
    expect(await scoreRow(live)).toBeDefined();
    expect(await scoreRow(draft)).toBeUndefined();
    expect(await scoreRow(future)).toBeUndefined();

    await env.db.query(`UPDATE games SET status='unpublished' WHERE id=$1`, [live]);
    expect(await computeScores(env.ctx)).toEqual({ games: 0, removed: 1 });
    expect(await scoreRow(live)).toBeUndefined();
  });

  it('is idempotent and updates rows in place', async () => {
    const owner = await user('owner');
    const g = await game(owner, 'g', 5);
    await computeScores(env.ctx);
    await like(await user('fan'), g, 1);
    await computeScores(env.ctx);
    await computeScores(env.ctx);
    const { rows } = await env.db.query(`SELECT * FROM game_scores`);
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, number>).engagement_24h).toBe(3);
  });

  it('does nothing and does not fail without games', async () => {
    expect(await computeScores(env.ctx)).toEqual({ games: 0, removed: 0 });
  });
});
