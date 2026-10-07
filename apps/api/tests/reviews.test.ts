import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, karmaOf, makeApp, makeGame, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client;
let bob: Client;
let cara: Client;
let game: { id: string; slug: string };
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  cara = await signup(app, 'cara');
  game = await makeGame(alice, { title: 'Reviewed Game' });
});

const LONG = 'A properly detailed review text.';

describe('reviews', () => {
  it('creates a review and updates the game and creator averages', async () => {
    const res = await bob.post(`/games/${game.id}/reviews`, { rating: 5, body: LONG });
    expect(res.status).toBe(201);
    expect(res.body.review).toMatchObject({ rating: 5, body: LONG, user: { username: 'bob' }, gameId: game.id });
    expect(res.body.karmaAwarded).toBe(3);

    await cara.post(`/games/${game.id}/reviews`, { rating: 2 });
    const g = (await alice.get(`/games/${game.slug}`)).body.game;
    expect(g).toMatchObject({ ratingAvg: 3.5, reviewsCount: 2 });
    expect((await alice.get('/users/alice')).body.user.stats).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 });
  });

  it("averages a creator's rating over all their games' reviews", async () => {
    const g2 = await makeGame(alice, { title: 'Second Game' });
    await bob.post(`/games/${game.id}/reviews`, { rating: 5 });
    await bob.post(`/games/${g2.id}/reviews`, { rating: 4 });
    await cara.post(`/games/${g2.id}/reviews`, { rating: 3 });
    expect((await alice.get('/users/alice')).body.user.stats).toMatchObject({ ratingAvg: 4, ratingCount: 3 });
  });

  it('allows one review per user per game, and never your own game', async () => {
    await bob.post(`/games/${game.id}/reviews`, { rating: 4 });
    const dup = await bob.post(`/games/${game.id}/reviews`, { rating: 5 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_REVIEWED');
    const own = await alice.post(`/games/${game.id}/reviews`, { rating: 5 });
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SELF_ACTION');
    expect((await new Client(app).post(`/games/${game.id}/reviews`, { rating: 5 })).status).toBe(401);
  });

  it.each([[0], [6], [3.5], ['5'], [null]])('rejects rating %j', async (rating) => {
    expect((await bob.post(`/games/${game.id}/reviews`, { rating })).status).toBe(422);
  });

  it('earns karma only for reviews with 20+ characters', async () => {
    expect((await bob.post(`/games/${game.id}/reviews`, { rating: 5, body: 'too short' })).body.karmaAwarded).toBe(0);
    expect(await karmaOf('bob')).toBe(0);
    expect((await cara.post(`/games/${game.id}/reviews`, { rating: 5, body: 'x'.repeat(20) })).body.karmaAwarded).toBe(3);
    expect((await cara.get('/auth/me')).body.user.karma).toBe(3);
  });

  it('moves karma when an edit crosses the 20 character line, in both directions, without double counting', async () => {
    const r = (await bob.post(`/games/${game.id}/reviews`, { rating: 4, body: 'short' })).body.review;
    expect(await karmaOf('bob')).toBe(0);

    const up = await bob.patch(`/reviews/${r.id}`, { body: LONG });
    expect(up.body.karmaAwarded).toBe(3);
    expect((await bob.patch(`/reviews/${r.id}`, { body: `${LONG} Edited again.` })).body.karmaAwarded).toBe(0); // already earned
    expect(await karmaOf('bob')).toBe(3);

    const down = await bob.patch(`/reviews/${r.id}`, { body: 'tiny' });
    expect(down.body.karmaAwarded).toBe(-3);
    expect(await karmaOf('bob')).toBe(0);

    const rated = await bob.patch(`/reviews/${r.id}`, { rating: 1 });
    expect(rated.body.review.rating).toBe(1);
    expect((await alice.get(`/games/${game.slug}`)).body.game.ratingAvg).toBe(1);
  });

  it('only the author edits; the author or an admin deletes; deleting reverses karma and averages', async () => {
    const r = (await bob.post(`/games/${game.id}/reviews`, { rating: 2, body: LONG })).body.review;
    expect((await cara.patch(`/reviews/${r.id}`, { rating: 5 })).status).toBe(403);
    expect((await cara.del(`/reviews/${r.id}`)).status).toBe(403);

    const del = await bob.del(`/reviews/${r.id}`);
    expect(del.body).toEqual({ karmaAwarded: -3 });
    expect(await karmaOf('bob')).toBe(0);
    expect((await alice.get(`/games/${game.slug}`)).body.game).toMatchObject({ ratingAvg: null, reviewsCount: 0 });
    expect((await alice.get('/users/alice')).body.user.stats).toMatchObject({ ratingAvg: null, ratingCount: 0 });
    expect((await bob.del(`/reviews/${r.id}`)).status).toBe(404);
    // after deleting you may review again
    expect((await bob.post(`/games/${game.id}/reviews`, { rating: 5 })).status).toBe(201);
  });

  it('lists reviews newest first with a distribution summary, paginated, and exposes myReview', async () => {
    const dan = await signup(app, 'dan');
    for (const [c, rating] of [[bob, 5], [cara, 5], [dan, 1]] as const) {
      await c.post(`/games/${game.id}/reviews`, { rating });
      await new Promise((r) => setTimeout(r, 5));
    }
    const page1 = await bob.get(`/games/${game.id}/reviews?limit=2`);
    expect(page1.body.items.map((r: any) => r.user.username)).toEqual(['dan', 'cara']);
    expect(page1.body.nextCursor).toBeTruthy();
    expect(page1.body.summary).toEqual({ ratingAvg: 3.67, ratingCount: 3, distribution: { '1': 1, '2': 0, '3': 0, '4': 0, '5': 2 } });
    const page2 = await bob.get(`/games/${game.id}/reviews?limit=2&cursor=${page1.body.nextCursor}`);
    expect(page2.body.items.map((r: any) => r.user.username)).toEqual(['bob']);
    expect(page2.body.nextCursor).toBeNull();

    expect((await bob.get(`/games/${game.slug}`)).body.game.myReview).toMatchObject({ rating: 5, user: { username: 'bob' } });
    expect((await new Client(app).get(`/games/${game.slug}`)).body.game.myReview).toBeNull();
    expect((await bob.get(`/games/${game.id}/reviews?cursor=garbage`)).status).toBe(400);
  });

  it('lists reviews on the reviewer profile', async () => {
    await bob.post(`/games/${game.id}/reviews`, { rating: 4, body: LONG });
    const res = await new Client(app).get('/users/bob/reviews');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ rating: 4, game: { slug: game.slug, title: 'Reviewed Game' } });
    expect(res.body.items[0].game.coverUrl).toMatch(/placeholders/);
  });
});
