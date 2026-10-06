import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMedia, Client, makeApp, makeGame, prisma, resetDb, signup } from './helpers.ts';

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

describe('creating and editing games', () => {
  it('creates a draft with a slug and normalised fields', async () => {
    const res = await alice.post('/games', {
      title: '  Honey Quest  ',
      tags: ['RPG', 'Cozy Game', 'rpg'],
      platforms: ['web', 'web', 'windows'],
    });
    expect(res.status).toBe(201);
    expect(res.body.game).toMatchObject({
      slug: 'honey-quest',
      title: 'Honey Quest',
      status: 'draft',
      tags: ['rpg', 'cozy-game'],
      platforms: ['web', 'windows'],
      likesCount: 0,
      likedByMe: false,
      owner: { username: 'alice' },
      screenshots: [],
      builds: [],
      video: null,
      cover: null,
    });
  });

  it('requires login and validates input', async () => {
    expect((await new Client(app).post('/games', { title: 'Nope Game' })).status).toBe(401);
    expect((await alice.post('/games', { title: 'ab' })).status).toBe(422);
    expect((await alice.post('/games', { title: 'Fine Title', tags: ['x'] })).status).toBe(422);
    expect((await alice.post('/games', { title: 'Fine Title', platforms: ['playstation'] })).status).toBe(422);
    expect((await alice.post('/games', { title: 'Fine Title', tags: Array.from({ length: 9 }, (_, i) => `tag-${i}`) })).status).toBe(422);
  });

  it('generates unique slugs for equal titles', async () => {
    const a = await alice.post('/games', { title: 'Same Name' });
    const b = await bob.post('/games', { title: 'Same Name' });
    expect(a.body.game.slug).toBe('same-name');
    expect(b.body.game.slug).toBe('same-name-2');
  });

  it('strips raw HTML from text fields', async () => {
    const res = await alice.post('/games', {
      title: 'Safe <b>Title</b>',
      description: 'Hello <script>alert(1)</script>world <img src=x onerror=alert(1)> <scr<script>ipt>alert(2)</scr</script>ipt>',
    });
    expect(res.body.game.title).toBe('Safe Title');
    expect(res.body.game.description).not.toMatch(/<\/?(script|img|b)/i);
    expect(res.body.game.description).toContain('Hello');
  });

  it('only the owner can edit; unknown ids are 404', async () => {
    const { id } = await makeGame(alice, { publish: false });
    expect((await bob.patch(`/games/${id}`, { title: 'Hacked Title' })).status).toBe(404); // drafts are invisible to others
    const { id: pub } = await makeGame(alice, { title: 'Public One' });
    expect((await bob.patch(`/games/${pub}`, { title: 'Hacked Title' })).status).toBe(403);
    expect((await alice.patch(`/games/${pub}`, { title: 'New Title', version: '2.0.0' })).body.game).toMatchObject({ title: 'New Title', version: '2.0.0', slug: 'public-one' });
    expect((await alice.patch('/games/not-a-uuid', { title: 'Whatever' })).status).toBe(404);
    expect((await alice.patch('/games/00000000-0000-7000-8000-000000000000', { title: 'Whatever' })).status).toBe(404);
  });

  it('accepts only your own ready cover as coverMediaId', async () => {
    const mine = await makeGame(alice, { publish: false });
    const other = await makeGame(bob, { publish: false });
    const scanning = await addMedia(mine.id, alice.user.id, 'cover', 'scanning');
    const screenshot = await addMedia(mine.id, alice.user.id, 'screenshot');
    for (const bad of [other.coverId, scanning.id, screenshot.id, 'nope']) {
      const res = await alice.patch(`/games/${mine.id}`, { coverMediaId: bad });
      expect(res.status, String(bad)).toBe(422);
    }
    const fresh = await addMedia(mine.id, alice.user.id, 'cover');
    expect((await alice.patch(`/games/${mine.id}`, { coverMediaId: fresh.id })).body.game.cover.id).toBe(fresh.id);
  });
});

describe('visibility', () => {
  it('drafts are visible to the owner and admins only; published to everyone', async () => {
    const draft = await makeGame(alice, { title: 'Secret Draft', publish: false });
    expect((await alice.get(`/games/${draft.slug}`)).status).toBe(200);
    expect((await bob.get(`/games/${draft.slug}`)).status).toBe(404);
    expect((await new Client(app).get(`/games/${draft.id}`)).status).toBe(404);

    await alice.post(`/games/${draft.id}/publish`);
    expect((await new Client(app).get(`/games/${draft.slug}`)).status).toBe(200);
    expect((await new Client(app).get(`/games/${draft.id}`)).body.game.slug).toBe(draft.slug); // by id too
  });

  it('non-owners only see ready media; builds never expose a url', async () => {
    const g = await makeGame(alice, { title: 'Media Game' });
    await addMedia(g.id, alice.user.id, 'screenshot', 'scanning');
    await addMedia(g.id, alice.user.id, 'screenshot', 'rejected');

    const asBob = (await bob.get(`/games/${g.slug}`)).body.game;
    expect(asBob.screenshots).toHaveLength(1);
    expect(asBob.builds).toHaveLength(1);
    expect(asBob.builds[0].url).toBeNull();
    expect(asBob.cover.url).toMatch(/^http:\/\/localhost:4000\/placeholders\/cover-/);
    expect(asBob.coverUrl).toBe(asBob.cover.url);

    const asAlice = (await alice.get(`/games/${g.slug}`)).body.game;
    expect(asAlice.screenshots).toHaveLength(3); // the owner sees upload states too
    expect(asAlice.builds[0].url).toBeNull();
  });
});

describe('publishing', () => {
  it('lists exactly what is missing', async () => {
    const res = await alice.post('/games', { title: 'Empty Draft' });
    const id = res.body.game.id;
    let pub = await alice.post(`/games/${id}/publish`);
    expect(pub.status).toBe(422);
    expect(pub.body.error).toMatchObject({ code: 'PUBLISH_REQUIREMENTS', details: { missing: ['cover', 'screenshot', 'build'] } });

    const cover = await addMedia(id, alice.user.id, 'cover');
    await alice.patch(`/games/${id}`, { coverMediaId: cover.id });
    await addMedia(id, alice.user.id, 'screenshot', 'processing' as never); // not ready yet
    await addMedia(id, alice.user.id, 'build', 'scanning');
    pub = await alice.post(`/games/${id}/publish`);
    expect(pub.body.error.details.missing).toEqual(['screenshot', 'build']);

    await addMedia(id, alice.user.id, 'screenshot');
    await addMedia(id, alice.user.id, 'build');
    pub = await alice.post(`/games/${id}/publish`);
    expect(pub.status).toBe(200);
    expect(pub.body.game.status).toBe('published');
    expect(pub.body.game.publishedAt).toBeTruthy();
  });

  it('keeps the games count in sync and keeps publishedAt across unpublish/publish', async () => {
    const g = await makeGame(alice, { title: 'Cycle Game' });
    expect((await alice.get('/users/alice')).body.user.stats.gamesCount).toBe(1);
    const first = (await alice.get(`/games/${g.id}`)).body.game.publishedAt;

    const un = await alice.post(`/games/${g.id}/unpublish`);
    expect(un.body.game.status).toBe('unpublished');
    expect((await alice.get('/users/alice')).body.user.stats.gamesCount).toBe(0);
    expect((await new Client(app).get(`/games/${g.slug}`)).status).toBe(404);

    const again = await alice.post(`/games/${g.id}/publish`);
    expect(again.body.game.publishedAt).toBe(first);
    expect((await alice.get('/users/alice')).body.user.stats.gamesCount).toBe(1);
  });

  it('cannot remove the cover of a published game', async () => {
    const g = await makeGame(alice, { title: 'Cover Needed' });
    const res = await alice.patch(`/games/${g.id}`, { coverMediaId: null });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PUBLISH_REQUIREMENTS');
  });
});

describe('deleting', () => {
  it('removes the game and fixes owner and commenter stats; only the owner may delete', async () => {
    const g = await makeGame(alice, { title: 'Doomed Game' });
    const cara = await signup(app, 'cara');
    await bob.put(`/games/${g.id}/like`);
    await cara.put(`/games/${g.id}/like`);
    const review = await cara.post(`/games/${g.id}/reviews`, { rating: 3 });
    expect(review.status).toBe(201);
    const comment = (await bob.post(`/games/${g.id}/comments`, { body: 'Nice one' })).body.comment;
    await cara.put(`/comments/${comment.id}/like`);

    expect((await alice.get('/users/alice')).body.user.stats).toMatchObject({ likesReceived: 2, ratingCount: 1 });
    expect((await alice.get('/users/bob')).body.user.stats.likesReceived).toBe(1);

    expect((await bob.del(`/games/${g.id}`)).status).toBe(403);
    expect((await alice.del(`/games/${g.id}`)).status).toBe(204);

    expect((await alice.get(`/games/${g.slug}`)).status).toBe(404);
    expect((await alice.get('/users/alice')).body.user.stats).toMatchObject({ likesReceived: 0, gamesCount: 0, ratingCount: 0, ratingAvg: null });
    expect((await alice.get('/users/bob')).body.user.stats.likesReceived).toBe(0);
    expect(await prisma.media.count({ where: { gameId: g.id } })).toBe(0);
    // karma that was earned stays earned
    expect((await bob.get('/auth/me')).body.user.karma).toBe(1 + 2);
  });
});
