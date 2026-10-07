import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeApp, makeGame, prisma, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client;
let bob: Client;
let cara: Client;
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  cara = await signup(app, 'cara');
});

const board = async (c: Client, type: string, period = 'week', extra = '') =>
  (await c.get(`/leaderboard?type=${type}&period=${period}${extra}`)).body;

describe('leaderboard', () => {
  it('ranks games by engagement (3·likes + 4·reviews + 2·comments), ignoring the creator’s own comments', async () => {
    const a = await makeGame(alice, { title: 'Liked Game' }); // 2 likes = 6
    const b = await makeGame(alice, { title: 'Reviewed Game' }); // 1 review = 4, own comment ignored
    const c = await makeGame(alice, { title: 'Chatty Game' }); // 2 comments = 4 ... plus 1 like = 7
    await bob.put(`/games/${a.id}/like`);
    await cara.put(`/games/${a.id}/like`);
    await bob.post(`/games/${b.id}/reviews`, { rating: 5 });
    await alice.post(`/games/${b.id}/comments`, { body: 'creator chatter' });
    await bob.post(`/games/${c.id}/comments`, { body: 'one' });
    await cara.post(`/games/${c.id}/comments`, { body: 'two' });
    await bob.put(`/games/${c.id}/like`);

    const res = await board(bob, 'games');
    expect(res).toMatchObject({ type: 'games', period: 'week' });
    expect(res.items.map((i: any) => [i.rank, i.score, i.game.title])).toEqual([
      [1, 7, 'Chatty Game'],
      [2, 6, 'Liked Game'],
      [3, 4, 'Reviewed Game'],
    ]);
    expect(res.items[0].game.likedByMe).toBe(true); // personalised even though the ranking is cached
  });

  it('respects the period, so old engagement drops out of week/month but stays in all-time', async () => {
    const g = await makeGame(alice, { title: 'Fading Game' });
    await bob.put(`/games/${g.id}/like`);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    await prisma.gameLike.updateMany({ data: { createdAt: ago(20) } });
    expect((await board(bob, 'games', 'week')).items).toHaveLength(0);
    expect((await board(bob, 'games', 'month')).items).toHaveLength(1);
    await prisma.gameLike.updateMany({ data: { createdAt: ago(45) } });
    expect((await board(bob, 'games', 'month')).items).toHaveLength(0);
    expect((await board(bob, 'games', 'all')).items[0]).toMatchObject({ rank: 1, score: 3 });
  });

  it('ranks creators by likes received and karma by karma earned, only counting published games/active users', async () => {
    const g = await makeGame(alice, { title: 'Alices Game' });
    const h = await makeGame(bob, { title: 'Bobs Game' });
    await cara.put(`/games/${g.id}/like`);
    await alice.put(`/games/${h.id}/like`);
    await cara.put(`/games/${h.id}/like`);

    for (const period of ['week', 'all']) {
      const creators = await board(cara, 'creators', period);
      expect(creators.items.map((i: any) => [i.rank, i.score, i.user.username]), period).toEqual([[1, 2, 'bob'], [2, 1, 'alice']]);
      expect(creators.items[0].user.stats).toMatchObject({ gamesCount: 1, likesReceived: 2 });
    }
    for (const period of ['week', 'all']) {
      const karma = await board(cara, 'karma', period);
      expect(karma.items.map((i: any) => [i.user.username, i.score]), period).toEqual([['cara', 2], ['alice', 1]]);
    }

    await bob.post(`/games/${h.id}/unpublish`); // an unpublished game no longer earns its creator a place
    expect((await board(cara, 'creators', 'all')).items.map((i: any) => i.user.username)).toEqual(['alice']);
  });

  it('validates parameters and honours limit', async () => {
    expect((await bob.get('/leaderboard')).status).toBe(422);
    expect((await bob.get('/leaderboard?type=nope')).status).toBe(422);
    expect((await bob.get('/leaderboard?type=games&period=year')).status).toBe(422);
    expect((await bob.get('/leaderboard?type=games&limit=51')).status).toBe(422);
    for (const t of ['A Game', 'B Game', 'C Game']) await bob.put(`/games/${(await makeGame(alice, { title: t })).id}/like`);
    expect((await board(bob, 'games', 'week', '&limit=2')).items).toHaveLength(2);
  });
});

describe('search', () => {
  beforeEach(async () => {
    await makeGame(alice, { title: 'Honey Quest', extra: { tags: ['rpg', 'cozy'], description: 'A sweet adventure about bees' } });
    await makeGame(alice, { title: 'Space Racer', extra: { tags: ['racing'], description: 'Fast ships' } });
    await makeGame(alice, { title: 'Quest For Cheese', extra: { tags: ['rpg'], description: 'Mice with swords' } });
    await makeGame(alice, { title: 'Secret Draft Quest', publish: false });
  });
  const search = async (q: string, extra = '') => (await bob.get(`/search?q=${encodeURIComponent(q)}${extra}`)).body;
  const names = (body: any) => body.items.map((i: any) => i.title ?? i.username);

  it('matches words, prefixes and description text; never drafts', async () => {
    expect(names(await search('quest'))).toEqual(expect.arrayContaining(['Honey Quest', 'Quest For Cheese']));
    expect(names(await search('quest'))).not.toContain('Secret Draft Quest');
    expect(names(await search('hon'))).toEqual(['Honey Quest']); // prefix
    expect(names(await search('bees'))).toEqual(['Honey Quest']); // description
    expect(names(await search('racing'))).toEqual(['Space Racer']); // tag
  });

  it('tolerates typos', async () => {
    expect(names(await search('Honey Qeust'))[0]).toBe('Honey Quest');
    expect(names(await search('Spase Racr'))[0]).toBe('Space Racer');
    expect(names(await search('xyzzy'))).toEqual([]);
  });

  it('ranks title matches above description matches', async () => {
    await makeGame(alice, { title: 'Unrelated Title', extra: { description: 'mentions cheese once' } });
    expect(names(await search('cheese'))[0]).toBe('Quest For Cheese');
  });

  it('filters by tags (all must match) and returns full game summaries', async () => {
    expect(names(await search('quest', '&tags=rpg'))).toHaveLength(2);
    expect(names(await search('quest', '&tags=rpg,cozy'))).toEqual(['Honey Quest']);
    expect(names(await search('quest', '&tags=racing'))).toEqual([]);
    const first = (await search('honey')).items[0];
    expect(first).toMatchObject({ slug: 'honey-quest', owner: { username: 'alice' }, likedByMe: false });
    expect(first.coverUrl).toMatch(/placeholders/);
  });

  it('searches users by username or display name, best match first', async () => {
    await signup(app, 'alina_k', { displayName: 'Queen Bee' });
    const res = await search('ali', '&type=users');
    expect(names(res)).toEqual(expect.arrayContaining(['alice', 'alina_k']));
    expect(res.items[0].stats).toBeDefined();
    expect(names(await search('queen bee', '&type=users'))).toEqual(['alina_k']);
    expect(names(await search('alise', '&type=users'))[0]).toBe('alice'); // typo
  });

  it('treats LIKE wildcards literally', async () => {
    // Fuzzy (trigram) matching ignores punctuation, so pick queries that could only match through an
    // unescaped wildcard: `a%e` would match "alice" as a LIKE pattern, and `%` would match everyone.
    expect(names(await search('%', '&type=users'))).toEqual([]);
    expect(names(await search('a%e', '&type=users'))).toEqual([]);
    expect(names(await search('al_ce', '&type=users'))).toEqual(['alice']); // fuzzy still finds it, as intended
  });

  it('paginates', async () => {
    for (let i = 0; i < 4; i++) await makeGame(alice, { title: `Pagination Test ${i}` });
    const p1 = await search('pagination', '&limit=3');
    expect(p1.items).toHaveLength(3);
    const p2 = await search('pagination', `&limit=3&cursor=${p1.nextCursor}`);
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...names(p1), ...names(p2)]).size).toBe(4);
  });

  it('validates the query', async () => {
    expect((await bob.get('/search')).status).toBe(422);
    expect((await bob.get('/search?q=')).status).toBe(422);
    expect((await bob.get(`/search?q=${'x'.repeat(81)}`)).status).toBe(422);
    expect((await bob.get('/search?q=a&type=cats')).status).toBe(422);
    expect(names(await search('!!! ???'))).toEqual([]); // punctuation only
  });

  it('suggests games and users for autocomplete', async () => {
    const res = (await bob.get('/search/suggest?q=al')).body;
    expect(res.users.map((u: any) => u.username)).toContain('alice');
    const g = (await bob.get('/search/suggest?q=hone')).body;
    expect(g.games).toEqual([{ id: expect.any(String), slug: 'honey-quest', title: 'Honey Quest', coverUrl: expect.stringContaining('placeholders') }]);
    expect((await bob.get('/search/suggest')).status).toBe(422);
  });

  it('lists popular tags of published games only', async () => {
    const res = await bob.get('/tags/popular');
    expect(res.body.items[0]).toEqual({ tag: 'rpg', count: 2 });
    expect(res.body.items.map((t: any) => t.tag)).toEqual(expect.arrayContaining(['cozy', 'racing']));
  });
});
