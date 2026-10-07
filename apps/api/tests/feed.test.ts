import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { interleave } from '../src/services/interleave.ts';
import { Client, makeApp, makeGame, prisma, resetDb, signup } from './helpers.ts';

describe('interleave (pure)', () => {
  it('follows Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest and skips exhausted lists', () => {
    const out = interleave({ buzzing: ['b1', 'b2'], fresh: ['f1', 'f2', 'f3'], sweetest: ['s1'] });
    expect(out.map((o) => `${o.badge[0]}:${o.id}`)).toEqual(['b:b1', 'f:f1', 's:s1', 'f:f2', 'b:b2', 'f:f3']);
  });

  it('never repeats a game; it keeps the badge of the first list that placed it', () => {
    const out = interleave({ buzzing: ['x', 'a'], fresh: ['x', 'b'], sweetest: ['x', 'c'] });
    expect(out.map((o) => o.id)).toEqual(['x', 'b', 'c', 'a']);
    expect(out[0]!.badge).toBe('buzzing');
    expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
  });

  it('handles empty input and respects the cap', () => {
    expect(interleave({ buzzing: [], fresh: [], sweetest: [] })).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => `g${i}`);
    expect(interleave({ buzzing: many, fresh: [], sweetest: [] }, 10)).toHaveLength(10);
  });
});

let app: FastifyInstance;
let alice: Client;
let bob: Client;
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
});

const publishedDaysAgo = (id: string, days: number) =>
  prisma.game.update({ where: { id }, data: { publishedAt: new Date(Date.now() - days * 86_400_000) } });
const feed = async (c: Client, qs = '') => (await c.get(`/feed${qs}`)).body;
const titles = (body: any) => body.items.map((i: any) => i.game.title);

describe('GET /feed', () => {
  it('is empty on an empty platform', async () => {
    expect(await feed(bob)).toEqual({ items: [], nextCursor: null });
  });

  it('falls back to newest-first before the worker has written any scores, badging recent games as fresh', async () => {
    const old = await makeGame(alice, { title: 'Old Game' });
    await publishedDaysAgo(old.id, 40);
    await makeGame(alice, { title: 'New Game' });
    const body = await feed(bob);
    expect(body.items.map((i: any) => [i.game.title, i.badge])).toEqual([['New Game', 'fresh'], ['Old Game', null]]);
  });

  it('mixes the three lists using game_scores', async () => {
    const mk = async (title: string, days = 1) => {
      const g = await makeGame(alice, { title });
      await publishedDaysAgo(g.id, days);
      return g;
    };
    const hot1 = await mk('Hot One', 30);
    const hot2 = await mk('Hot Two', 30);
    const loved1 = await mk('Loved One', 30);
    const loved2 = await mk('Loved Two', 30);
    const newer = await mk('Newer', 1);
    const newest = await mk('Newest', 0.1);
    const score = (gameId: string, s: { rising?: number; loved?: number }) =>
      prisma.gameScore.create({ data: { gameId, risingScore: s.rising ?? 0, lovedScore: s.loved ?? 0 } });
    await score(hot1.id, { rising: 9 });
    await score(hot2.id, { rising: 5 });
    await score(loved1.id, { loved: 7 });
    await score(loved2.id, { loved: 3 });

    const body = await feed(bob);
    // Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest, then the rest newest-first
    expect(body.items.map((i: any) => [i.badge, i.game.title])).toEqual([
      ['buzzing', 'Hot One'],
      ['fresh', 'Newest'], // fresh_score falls back to recency for games without a score row
      ['sweetest', 'Loved One'],
      ['fresh', 'Newer'],
      ['buzzing', 'Hot Two'],
      ['sweetest', 'Loved Two'],
    ]);
  });

  it('puts a game published seconds ago into the fresh slots immediately (cold start)', async () => {
    for (let i = 0; i < 3; i++) await publishedDaysAgo((await makeGame(alice, { title: `Older ${i}` })).id, 20 + i);
    await makeGame(alice, { title: 'Just Published' });
    const first = (await feed(bob)).items[0];
    expect(first).toMatchObject({ badge: 'fresh', game: { title: 'Just Published' } });
  });

  it('paginates without duplicates or gaps, and ends with a null cursor', async () => {
    for (let i = 0; i < 7; i++) await publishedDaysAgo((await makeGame(alice, { title: `Game ${i}` })).id, i + 1);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: any = await feed(bob, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(body));
      cursor = body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect((await bob.get('/feed?cursor=%%%')).status).toBe(400);
    expect((await bob.get('/feed?limit=500')).status).toBe(422);
  });

  it('personalises likedByMe, and hides unpublished games straight away', async () => {
    const g = await makeGame(alice, { title: 'Likeable' });
    await bob.put(`/games/${g.id}/like`);
    expect((await feed(bob)).items[0].game).toMatchObject({ likedByMe: true, likesCount: 1, owner: { username: 'alice' } });
    expect((await feed(new Client(app))).items[0].game.likedByMe).toBe(false);
    await alice.post(`/games/${g.id}/unpublish`);
    expect((await feed(bob)).items).toEqual([]);
  });
});

describe('GET /feed/buzzing', () => {
  it('lists rising games first, then pads with popular recent ones (no badge)', async () => {
    const rising = await makeGame(alice, { title: 'Rising' });
    const popular = await makeGame(alice, { title: 'Popular' });
    await makeGame(alice, { title: 'Quiet' });
    await prisma.gameScore.create({ data: { gameId: rising.id, risingScore: 4 } });
    await bob.put(`/games/${popular.id}/like`);

    const res = await bob.get('/feed/buzzing?limit=3');
    expect(res.body.items.map((i: any) => [i.game.title, i.badge])).toEqual([['Rising', 'buzzing'], ['Popular', null], ['Quiet', null]]);
    expect((await bob.get('/feed/buzzing?limit=99')).status).toBe(422);
  });
});
