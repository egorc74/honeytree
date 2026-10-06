import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, karmaOf, makeApp, makeGame, prisma, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client; // creator
let bob: Client; // gamer
let game: { id: string; slug: string };
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  game = await makeGame(alice, { title: 'Liked Game' });
});

const ledger = (username: string) =>
  prisma.karmaEvent.findMany({ where: { user: { username } }, orderBy: { createdAt: 'asc' }, select: { amount: true, reason: true } });

/** Pre-fill today's ledger, as if the user had already earned `amount` karma for `reason` today. */
const earnedToday = (userId: string, reason: 'like_game' | 'review', amount: number, when = new Date()) =>
  prisma.karmaEvent.create({ data: { userId, amount, reason, refType: 'game', refId: randomUUID(), createdAt: when } });

describe('liking a game', () => {
  it('likes and unlikes, keeping counters, likedByMe and karma in step', async () => {
    const like = await bob.put(`/games/${game.id}/like`);
    expect(like.body).toEqual({ liked: true, likesCount: 1, karmaAwarded: 1 });
    expect((await bob.get(`/games/${game.slug}`)).body.game).toMatchObject({ likesCount: 1, likedByMe: true });
    expect((await new Client(app).get(`/games/${game.slug}`)).body.game).toMatchObject({ likesCount: 1, likedByMe: false });
    expect((await alice.get('/users/alice')).body.user.stats.likesReceived).toBe(1);
    expect(await karmaOf('bob')).toBe(1);
    expect(await karmaOf('alice')).toBe(0); // the actor earns, not the creator

    const unlike = await bob.del(`/games/${game.id}/like`);
    expect(unlike.body).toEqual({ liked: false, likesCount: 0, karmaAwarded: -1 });
    expect((await alice.get('/users/alice')).body.user.stats.likesReceived).toBe(0);
    expect(await karmaOf('bob')).toBe(0);
    expect(await ledger('bob')).toEqual([{ amount: 1, reason: 'like_game' }, { amount: -1, reason: 'reversal' }]);
  });

  it('is idempotent in both directions', async () => {
    await bob.put(`/games/${game.id}/like`);
    expect((await bob.put(`/games/${game.id}/like`)).body).toEqual({ liked: true, likesCount: 1, karmaAwarded: 0 });
    await bob.del(`/games/${game.id}/like`);
    expect((await bob.del(`/games/${game.id}/like`)).body).toEqual({ liked: false, likesCount: 0, karmaAwarded: 0 });
    expect(await karmaOf('bob')).toBe(0);
  });

  it('counts parallel duplicate likes once', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => bob.put(`/games/${game.id}/like`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.reduce((n, r) => n + r.body.karmaAwarded, 0)).toBe(1);
    expect((await bob.get(`/games/${game.slug}`)).body.game.likesCount).toBe(1);
    expect(await prisma.gameLike.count()).toBe(1);
  });

  it('refuses likes on your own game, drafts, unknown ids and anonymous users', async () => {
    const own = await alice.put(`/games/${game.id}/like`);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SELF_ACTION');
    const draft = await makeGame(alice, { title: 'Draft Only', publish: false });
    expect((await bob.put(`/games/${draft.id}/like`)).status).toBe(404);
    expect((await bob.put('/games/not-a-uuid/like')).status).toBe(404);
    expect((await new Client(app).put(`/games/${game.id}/like`)).status).toBe(401);
    expect(await prisma.gameLike.count()).toBe(0);
  });

  it('like -> unlike -> like cannot be farmed', async () => {
    for (let i = 0; i < 5; i++) {
      await bob.put(`/games/${game.id}/like`);
      await bob.del(`/games/${game.id}/like`);
    }
    await bob.put(`/games/${game.id}/like`);
    expect(await karmaOf('bob')).toBe(1);
  });
});

describe('daily karma caps', () => {
  it('caps karma from likes at 50 per day', async () => {
    await earnedToday(bob.user.id, 'like_game', 50);
    const res = await bob.put(`/games/${game.id}/like`);
    expect(res.body).toEqual({ liked: true, likesCount: 1, karmaAwarded: 0 }); // the like still counts, the karma does not
    expect(await karmaOf('bob')).toBe(0); // (the pre-filled ledger rows bypass the cached total)
    expect(await prisma.karmaEvent.count({ where: { userId: bob.user.id } })).toBe(1);
  });

  it('caps total karma at 100 per day and awards partially near the cap', async () => {
    await earnedToday(bob.user.id, 'review', 99);
    const comment = await bob.post(`/games/${game.id}/comments`, { body: 'Nice game' }); // worth 2, only 1 of room
    expect(comment.body.karmaAwarded).toBe(1);
    const more = await bob.post(`/games/${game.id}/comments`, { body: 'Another one' });
    expect(more.body.karmaAwarded).toBe(0);
    expect(more.status).toBe(201); // the comment itself is never blocked by the cap
  });

  it("does not count yesterday's karma", async () => {
    await earnedToday(bob.user.id, 'like_game', 50, new Date(Date.now() - 36 * 3_600_000));
    expect((await bob.put(`/games/${game.id}/like`)).body.karmaAwarded).toBe(1);
  });

  it('a reversal frees the capacity it took', async () => {
    await earnedToday(bob.user.id, 'like_game', 49);
    expect((await bob.put(`/games/${game.id}/like`)).body.karmaAwarded).toBe(1); // 50/50
    const g2 = await makeGame(alice, { title: 'Second Game' });
    expect((await bob.put(`/games/${g2.id}/like`)).body.karmaAwarded).toBe(0); // capped
    await bob.del(`/games/${game.id}/like`); // -1
    // The capped like on g2 stays unrewarded (karma is granted at action time, never retroactively)...
    expect((await bob.put(`/games/${g2.id}/like`)).body.karmaAwarded).toBe(0);
    // ...but the freed capacity is available for the next new like.
    const g3 = await makeGame(alice, { title: 'Third Game' });
    expect((await bob.put(`/games/${g3.id}/like`)).body.karmaAwarded).toBe(1);
  });
});

describe('liking comments', () => {
  it('awards the liker, credits the author with a like received, and reverses on unlike', async () => {
    const c = (await bob.post(`/games/${game.id}/comments`, { body: 'Great stuff' })).body.comment;
    const cara = await signup(app, 'cara');

    const like = await cara.put(`/comments/${c.id}/like`);
    expect(like.body).toEqual({ liked: true, likesCount: 1, karmaAwarded: 1 });
    expect(await karmaOf('cara')).toBe(1);
    expect((await bob.get('/users/bob')).body.user.stats.likesReceived).toBe(1);
    expect((await cara.get(`/games/${game.id}/comments`)).body.items[0]).toMatchObject({ likesCount: 1, likedByMe: true });

    expect((await cara.put(`/comments/${c.id}/like`)).body.karmaAwarded).toBe(0); // idempotent
    const unlike = await cara.del(`/comments/${c.id}/like`);
    expect(unlike.body).toEqual({ liked: false, likesCount: 0, karmaAwarded: -1 });
    expect(await karmaOf('cara')).toBe(0);
    expect((await bob.get('/users/bob')).body.user.stats.likesReceived).toBe(0);
  });

  it('refuses liking your own comment, and comments that are deleted or on hidden games', async () => {
    const c = (await bob.post(`/games/${game.id}/comments`, { body: 'Mine' })).body.comment;
    const own = await bob.put(`/comments/${c.id}/like`);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('SELF_ACTION');

    await bob.del(`/comments/${c.id}`);
    expect((await alice.put(`/comments/${c.id}/like`)).status).toBe(404);

    const c2 = (await bob.post(`/games/${game.id}/comments`, { body: 'Second' })).body.comment;
    await alice.post(`/games/${game.id}/unpublish`);
    expect((await alice.put(`/comments/${c2.id}/like`)).status).toBe(404);
  });
});

describe('the karma table (PLAN 1.7)', () => {
  it('comment +2, suggestion +3, review +3 (20+ chars), like +1', async () => {
    await bob.put(`/games/${game.id}/like`);
    await bob.post(`/games/${game.id}/comments`, { body: 'A comment' });
    await bob.post(`/games/${game.id}/comments`, { body: 'A suggestion', kind: 'suggestion' });
    await bob.post(`/games/${game.id}/reviews`, { rating: 5, body: 'This is a proper review text.' });
    expect(await ledger('bob')).toEqual([
      { amount: 1, reason: 'like_game' },
      { amount: 2, reason: 'comment' },
      { amount: 3, reason: 'suggestion' },
      { amount: 3, reason: 'review' },
    ]);
    expect(await karmaOf('bob')).toBe(9);
    expect((await bob.get('/auth/me')).body.user.karma).toBe(9);
  });

  it('gives a creator no karma for activity on their own game and threads', async () => {
    const c = (await bob.post(`/games/${game.id}/comments`, { body: 'Question?' })).body.comment;
    const reply = await alice.post(`/games/${game.id}/comments`, { body: 'Answer!', parentId: c.id });
    expect(reply.body.karmaAwarded).toBe(0);
    expect((await alice.post(`/games/${game.id}/comments`, { body: 'Update!' })).body.karmaAwarded).toBe(0);
    expect(await karmaOf('alice')).toBe(0);

    // ...and a gamer replying inside their own thread earns nothing for it either
    const g2 = await makeGame(bob, { title: 'Bobs Game' });
    const top = (await alice.post(`/games/${g2.id}/comments`, { body: 'Cool' })).body.comment;
    const before = await karmaOf('alice');
    expect((await alice.post(`/games/${g2.id}/comments`, { body: 'Replying to myself', parentId: top.id })).body.karmaAwarded).toBe(0);
    expect(await karmaOf('alice')).toBe(before);
  });
});
