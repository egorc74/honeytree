import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMedia, Client, makeApp, makeGame, resetDb, signup } from './helpers.ts';

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

describe('profile stats', () => {
  it('reports likes received, games, average rating and karma', async () => {
    const empty = (await new Client(app).get('/users/alice')).body.user;
    expect(empty).toMatchObject({ username: 'alice', bio: '', links: [], stats: { likesReceived: 0, gamesCount: 0, ratingAvg: null, ratingCount: 0, karma: 0 } });

    const g1 = await makeGame(alice, { title: 'Game One' });
    const g2 = await makeGame(alice, { title: 'Game Two' });
    await makeGame(alice, { title: 'Draft Three', publish: false });
    const cara = await signup(app, 'cara');
    await bob.put(`/games/${g1.id}/like`);
    await bob.put(`/games/${g2.id}/like`);
    await cara.put(`/games/${g1.id}/like`);
    await bob.post(`/games/${g1.id}/reviews`, { rating: 5 });
    await cara.post(`/games/${g2.id}/reviews`, { rating: 4 });
    // a like on one of alice's comments is also a like received
    const comment = (await alice.post(`/games/${(await makeGame(bob, { title: 'Bobs Game' })).id}/comments`, { body: 'Nice' })).body.comment;
    await cara.put(`/comments/${comment.id}/like`);

    const stats = (await new Client(app).get('/users/alice')).body.user.stats;
    expect(stats).toEqual({ likesReceived: 4, gamesCount: 2, ratingAvg: 4.5, ratingCount: 2, karma: 2 });
  });

  it('is case-insensitive and 404s for unknown users', async () => {
    expect((await new Client(app).get('/users/ALICE')).status).toBe(200);
    expect((await new Client(app).get('/users/ghost')).status).toBe(404);
  });
});

describe('editing the profile', () => {
  it('updates display name, bio and links and strips HTML', async () => {
    const res = await alice.patch('/users/me', {
      displayName: 'Queen <i>Alice</i>',
      bio: 'Hi <script>x</script>there',
      links: [{ label: 'Site', url: 'https://example.com/me' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ displayName: 'Queen Alice', bio: 'Hi there', links: [{ label: 'Site', url: 'https://example.com/me' }] });
    expect((await new Client(app).get('/users/alice')).body.user.displayName).toBe('Queen Alice');
  });

  it('only allows http(s) links, at most 5', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.io', 'not a url']) {
      expect((await alice.patch('/users/me', { links: [{ label: 'x', url }] })).status, url).toBe(422);
    }
    const six = Array.from({ length: 6 }, (_, i) => ({ label: `l${i}`, url: 'https://example.com' }));
    expect((await alice.patch('/users/me', { links: six })).status).toBe(422);
    expect((await new Client(app).patch('/users/me', { bio: 'x' })).status).toBe(401);
  });

  it('accepts only your own ready avatar upload', async () => {
    const mine = await addMedia(null, alice.user.id, 'avatar');
    const theirs = await addMedia(null, bob.user.id, 'avatar');
    const wrongKind = await addMedia(null, alice.user.id, 'screenshot');
    const scanning = await addMedia(null, alice.user.id, 'avatar', 'scanning');
    for (const id of [theirs.id, wrongKind.id, scanning.id, 'nope']) {
      expect((await alice.patch('/users/me', { avatarMediaId: id })).status, id).toBe(422);
    }
    const ok = await alice.patch('/users/me', { avatarMediaId: mine.id });
    expect(ok.body.user.avatarUrl).toMatch(/placeholders\/avatar-/);
    expect((await alice.get('/auth/me')).body.user.avatarUrl).toBe(ok.body.user.avatarUrl);
    expect((await alice.patch('/users/me', { avatarMediaId: null })).body.user.avatarUrl).toBeNull();
  });

  it('resolves storage keys to bucket URLs and prefers variants', async () => {
    const m = await addMedia(null, alice.user.id, 'avatar');
    const { prisma } = await import('./helpers.ts');
    await prisma.media.update({ where: { id: m.id }, data: { storageKey: 'avatars/a.png', variants: { thumb: 'avatars/a-320.webp' } } });
    const res = await alice.patch('/users/me', { avatarMediaId: m.id });
    expect(res.body.user.avatarUrl).toBe('http://localhost:9000/honeytree/avatars/a-320.webp');
  });
});

describe("a user's games and activity", () => {
  it('shows only published games to others, all statuses to the owner, paginated', async () => {
    await makeGame(alice, { title: 'Published A' });
    await new Promise((r) => setTimeout(r, 5));
    await makeGame(alice, { title: 'Published B' });
    await makeGame(alice, { title: 'Just A Draft', publish: false });

    const others = (await bob.get('/users/alice/games')).body.items.map((g: any) => g.title);
    expect(others).toEqual(['Published B', 'Published A']);
    expect((await bob.get('/users/alice/games?status=draft')).body.items.map((g: any) => g.title)).toEqual(['Published B', 'Published A']); // ignored for others
    expect((await alice.get('/users/alice/games?status=draft')).body.items.map((g: any) => g.title)).toEqual(['Just A Draft']);
    expect((await alice.get('/users/alice/games?status=all')).body.items).toHaveLength(3);

    const p1 = await bob.get('/users/alice/games?limit=1');
    const p2 = await bob.get(`/users/alice/games?limit=1&cursor=${p1.body.nextCursor}`);
    expect([p1.body.items[0].title, p2.body.items[0].title]).toEqual(['Published B', 'Published A']);
    expect(p2.body.nextCursor).toBeNull();
  });

  it('lists recent activity', async () => {
    const g = await makeGame(alice, { title: 'Active Game' });
    await bob.put(`/games/${g.id}/like`);
    await bob.post(`/games/${g.id}/comments`, { body: 'Loved it', kind: 'suggestion' });
    await bob.post(`/games/${g.id}/reviews`, { rating: 4, body: 'Pretty good overall.' });
    const items = (await new Client(app).get('/users/bob/activity')).body.items;
    expect(items.map((i: any) => i.type).sort()).toEqual(['like', 'review', 'suggestion']);
    expect(items.find((i: any) => i.type === 'review')).toMatchObject({ rating: 4, excerpt: 'Pretty good overall.', game: { slug: g.slug } });
    expect((await new Client(app).get('/users/alice/activity')).body.items.map((i: any) => i.type)).toEqual(['published']);
  });
});
