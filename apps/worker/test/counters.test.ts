import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recheckCounters } from '../src/processors/counters';
import { createWorkerEnv, type WorkerEnv } from './helpers';

let env: WorkerEnv;
beforeEach(async () => {
  env = await createWorkerEnv();
});
afterEach(() => env.cleanup());

async function seed() {
  const q = async (sql: string, p: unknown[] = []) =>
    (await env.db.query<{ id: string }>(sql, p)).rows;
  const [owner] = await q(
    `INSERT INTO users (username, email) VALUES ('owner','o@x') RETURNING id`,
  );
  const [fan1] = await q(`INSERT INTO users (username, email) VALUES ('fan1','f1@x') RETURNING id`);
  const [fan2] = await q(`INSERT INTO users (username, email) VALUES ('fan2','f2@x') RETURNING id`);
  const [published] = await q(
    `INSERT INTO games (owner_id, slug, title, status) VALUES ($1,'p','P','published') RETURNING id`,
    [owner!.id],
  );
  const [draft] = await q(
    `INSERT INTO games (owner_id, slug, title, status) VALUES ($1,'d','D','draft') RETURNING id`,
    [owner!.id],
  );
  const g = published!.id;
  for (const u of [fan1!.id, fan2!.id, owner!.id])
    await q(`INSERT INTO game_likes (user_id, game_id) VALUES ($1,$2) RETURNING 1 AS id`, [u, g]);
  await q(`INSERT INTO game_likes (user_id, game_id) VALUES ($1,$2) RETURNING 1 AS id`, [
    fan1!.id,
    draft!.id,
  ]);
  await q(`INSERT INTO reviews (game_id, user_id, rating) VALUES ($1,$2,5) RETURNING 1 AS id`, [
    g,
    fan1!.id,
  ]);
  await q(`INSERT INTO reviews (game_id, user_id, rating) VALUES ($1,$2,2) RETURNING 1 AS id`, [
    g,
    fan2!.id,
  ]);
  await q(`INSERT INTO reviews (game_id, user_id, rating) VALUES ($1,$2,5) RETURNING 1 AS id`, [
    g,
    owner!.id,
  ]); // own review: not counted for the creator stats
  const [c1] = await q(`INSERT INTO comments (game_id, user_id) VALUES ($1,$2) RETURNING id`, [
    g,
    fan1!.id,
  ]);
  await q(
    `INSERT INTO comments (game_id, user_id, deleted_at) VALUES ($1,$2, now()) RETURNING id`,
    [g, fan2!.id],
  );
  await q(`INSERT INTO comment_likes (user_id, comment_id) VALUES ($1,$2) RETURNING 1 AS id`, [
    fan2!.id,
    c1!.id,
  ]);
  await q(`INSERT INTO downloads (game_id, user_id, ip_hash) VALUES ($1,$2,'h') RETURNING id`, [
    g,
    fan1!.id,
  ]);
  await q(
    `INSERT INTO karma_events (user_id, amount, reason) VALUES ($1, 3, 'review') RETURNING id`,
    [fan1!.id],
  );
  await q(
    `INSERT INTO karma_events (user_id, amount, reason) VALUES ($1, 2, 'comment') RETURNING id`,
    [fan1!.id],
  );
  await q(
    `INSERT INTO karma_events (user_id, amount, reason) VALUES ($1, -2, 'reversal') RETURNING id`,
    [fan1!.id],
  );
  return { owner: owner!.id, fan1: fan1!.id, game: g, comment: c1!.id };
}
const one = async (sql: string, p: unknown[]) =>
  (await env.db.query<Record<string, number>>(sql, p)).rows[0]!;

describe('recheckCounters', () => {
  it('reports drift without changing anything in report mode', async () => {
    const s = await seed();
    const drift = await recheckCounters(env.ctx, 'report');
    expect(drift['games.likes_count']).toBe(2); // published and draft both start at 0
    expect(drift['users.karma_total']).toBe(1);
    expect((await one(`SELECT likes_count FROM games WHERE id=$1`, [s.game]))['likes_count']).toBe(
      0,
    );
  });

  it('fixes every counter to the value the rows imply', async () => {
    const s = await seed();
    await recheckCounters(env.ctx, 'fix');
    const g = await one(`SELECT * FROM games WHERE id=$1`, [s.game]);
    expect(g).toMatchObject({
      likes_count: 3,
      comments_count: 1,
      reviews_count: 3,
      downloads_count: 1,
    });
    expect(g['rating_avg']).toBeCloseTo(4);
    expect(
      (await one(`SELECT likes_count FROM comments WHERE id=$1`, [s.comment]))['likes_count'],
    ).toBe(1);

    // creator stats: published games only, the creator's own likes and reviews do not count
    const owner = await one(`SELECT * FROM users WHERE id=$1`, [s.owner]);
    expect(owner).toMatchObject({ games_count: 1, likes_received_total: 2, rating_count: 2 });
    expect(owner['rating_avg']).toBeCloseTo(3.5);
    expect((await one(`SELECT * FROM users WHERE id=$1`, [s.fan1]))['karma_total']).toBe(3);
  });

  it('is a no-op the second time', async () => {
    await seed();
    await recheckCounters(env.ctx, 'fix');
    const again = await recheckCounters(env.ctx, 'fix');
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });

  it('zeroes counters of rows with nothing behind them', async () => {
    const s = await seed();
    await env.db.query(
      `UPDATE users SET rating_avg = 4.2, rating_count = 9, games_count = 4 WHERE id = $1`,
      [s.fan1],
    );
    await recheckCounters(env.ctx, 'fix');
    expect(
      await one(`SELECT rating_avg, rating_count, games_count FROM users WHERE id=$1`, [s.fan1]),
    ).toEqual({
      rating_avg: 0,
      rating_count: 0,
      games_count: 0,
    });
  });
});
