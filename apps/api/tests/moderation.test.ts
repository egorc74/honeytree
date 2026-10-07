import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeAdmin, makeApp, makeGame, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client;
let bob: Client;
let admin: Client;
let game: { id: string; slug: string };
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  admin = await signup(app, 'hivemaster');
  await makeAdmin(admin);
  game = await makeGame(alice, { title: 'Reported Game' });
});

describe('reports', () => {
  it('lets a logged-in user report games, comments, reviews and users', async () => {
    const comment = (await bob.post(`/games/${game.id}/comments`, { body: 'spam' })).body.comment;
    const cara = await signup(app, 'cara');
    const review = (await cara.post(`/games/${game.id}/reviews`, { rating: 1 })).body.review;
    for (const [targetType, targetId] of [['game', game.id], ['comment', comment.id], ['review', review.id], ['user', alice.user.id]]) {
      const res = await bob.post('/reports', { targetType, targetId, reason: 'This is abusive' });
      expect(res.status, targetType).toBe(201);
      expect(res.body.report.id).toBeTruthy();
    }
  });

  it('validates, requires login, and is a no-op for a repeated open report', async () => {
    expect((await new Client(app).post('/reports', { targetType: 'game', targetId: game.id, reason: 'bad' })).status).toBe(401);
    expect((await bob.post('/reports', { targetType: 'planet', targetId: game.id, reason: 'bad' })).status).toBe(422);
    expect((await bob.post('/reports', { targetType: 'game', targetId: game.id, reason: 'x' })).status).toBe(422);
    expect((await bob.post('/reports', { targetType: 'game', targetId: 'nope', reason: 'bad one' })).status).toBe(404);
    expect((await bob.post('/reports', { targetType: 'game', targetId: '00000000-0000-7000-8000-000000000000', reason: 'bad one' })).status).toBe(404);

    const first = await bob.post('/reports', { targetType: 'game', targetId: game.id, reason: 'Malware inside' });
    const again = await bob.post('/reports', { targetType: 'game', targetId: game.id, reason: 'Malware inside!!' });
    expect(again.body.report.id).toBe(first.body.report.id);
  });
});

describe('admin', () => {
  it('is for admins only', async () => {
    expect((await new Client(app).get('/admin/reports')).status).toBe(401);
    expect((await bob.get('/admin/reports')).status).toBe(403);
    expect((await bob.post(`/admin/games/${game.id}/remove`)).status).toBe(403);
    expect((await alice.post(`/admin/games/${game.id}/remove`)).status).toBe(403); // not even the creator
  });

  it('lists open reports and resolves them', async () => {
    const r = (await bob.post('/reports', { targetType: 'game', targetId: game.id, reason: 'Malware inside' })).body.report;
    const open = await admin.get('/admin/reports');
    expect(open.body.items).toHaveLength(1);
    expect(open.body.items[0]).toMatchObject({ id: r.id, targetType: 'game', targetId: game.id, reason: 'Malware inside', status: 'open', reporter: { username: 'bob' } });

    expect((await admin.post(`/admin/reports/${r.id}/resolve`)).body.report).toEqual({ id: r.id, status: 'resolved' });
    expect((await admin.get('/admin/reports')).body.items).toHaveLength(0);
    expect((await admin.get('/admin/reports?status=resolved')).body.items).toHaveLength(1);
    expect((await admin.post('/admin/reports/00000000-0000-7000-8000-000000000000/resolve')).status).toBe(404);
  });

  it('removing a game hides it everywhere; restoring makes it unpublished, never live', async () => {
    await bob.put(`/games/${game.id}/like`);
    expect((await admin.post(`/admin/games/${game.id}/remove`)).body.game.status).toBe('removed');

    const anon = new Client(app);
    expect((await anon.get(`/games/${game.slug}`)).status).toBe(404);
    expect((await anon.get('/feed')).body.items).toEqual([]);
    expect((await anon.get('/search?q=reported')).body.items).toEqual([]);
    expect((await anon.get('/users/alice/games')).body.items).toEqual([]);
    expect((await anon.get('/leaderboard?type=games&period=all')).body.items).toEqual([]);
    expect((await anon.get('/users/alice')).body.user.stats.gamesCount).toBe(0);
    expect((await bob.put(`/games/${game.id}/like`)).status).toBe(404);
    expect((await bob.post(`/games/${game.id}/comments`, { body: 'hi' })).status).toBe(404);

    // The creator can still see it (to learn why) but can neither edit nor republish it.
    expect((await alice.get(`/games/${game.slug}`)).body.game.status).toBe('removed');
    expect((await alice.patch(`/games/${game.id}`, { title: 'Sneaky Edit' })).status).toBe(403);
    expect((await alice.post(`/games/${game.id}/publish`)).status).toBe(403);
    expect((await alice.del(`/games/${game.id}`)).status).toBe(403);

    expect((await admin.post(`/admin/games/${game.id}/restore`)).body.game.status).toBe('unpublished');
    expect((await anon.get(`/games/${game.slug}`)).status).toBe(404); // still not public
    expect((await alice.post(`/games/${game.id}/publish`)).status).toBe(200);
    expect((await anon.get(`/games/${game.slug}`)).status).toBe(200);
  });

  it('restore does nothing to a game that is not removed', async () => {
    expect((await admin.post(`/admin/games/${game.id}/restore`)).body.game.status).toBe('published');
  });
});
