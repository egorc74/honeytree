import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, makeApp, prisma, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(resetDb);

describe('auth', () => {
  it('registers, sets an httpOnly session cookie and returns the user without secrets', async () => {
    const c = new Client(app);
    const res = await c.post('/auth/register', { username: 'Alice_1', email: 'Alice@Test.io', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'alice_1', email: 'alice@test.io', role: 'user', karma: 0, displayName: 'alice_1', avatarUrl: null });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    expect(String(res.headers['set-cookie'])).toMatch(/ht_session=.+HttpOnly/i);
    expect(String(res.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
  });

  it('only stores a hash of the session token', async () => {
    const c = await signup(app, 'alice');
    const token = c.cookie.split('=')[1]!;
    expect(await prisma.session.count({ where: { id: token } })).toBe(0);
    expect(await prisma.session.count()).toBe(1);
  });

  it('rejects duplicates with specific codes', async () => {
    await signup(app, 'alice');
    const c = new Client(app);
    expect((await c.post('/auth/register', { username: 'alice', email: 'other@test.io', password: 'password123' })).body.error.code).toBe('USERNAME_TAKEN');
    expect((await c.post('/auth/register', { username: 'bob', email: 'ALICE@test.io', password: 'password123' })).body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    [{ username: 'ab', email: 'a@b.io', password: 'password123' }],
    [{ username: 'has space', email: 'a@b.io', password: 'password123' }],
    [{ username: 'admin', email: 'a@b.io', password: 'password123' }],
    [{ username: 'okname', email: 'not-an-email', password: 'password123' }],
    [{ username: 'okname', email: 'a@b.io', password: 'short' }],
    [{}],
  ])('validates registration input %j', async (payload) => {
    const res = await new Client(app).post('/auth/register', payload);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in by username or email, and rejects wrong credentials uniformly', async () => {
    await signup(app, 'alice');
    expect((await new Client(app).post('/auth/login', { identifier: 'ALICE', password: 'password123' })).status).toBe(200);
    expect((await new Client(app).post('/auth/login', { identifier: 'alice@test.io', password: 'password123' })).status).toBe(200);
    const wrongPw = await new Client(app).post('/auth/login', { identifier: 'alice', password: 'nope-nope' });
    const noUser = await new Client(app).post('/auth/login', { identifier: 'ghost', password: 'nope-nope' });
    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body); // does not reveal which accounts exist
  });

  it('me requires a session; logout destroys it server-side', async () => {
    expect((await new Client(app).get('/auth/me')).status).toBe(401);
    const c = await signup(app, 'alice');
    expect((await c.get('/auth/me')).body.user.username).toBe('alice');

    const stale = c.cookie;
    expect((await c.post('/auth/logout')).status).toBe(204);
    const replay = new Client(app);
    replay.cookie = stale;
    expect((await replay.get('/auth/me')).status).toBe(401); // the old cookie is dead, not just cleared
  });

  it('ignores expired sessions', async () => {
    const c = await signup(app, 'alice');
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.get('/auth/me')).status).toBe(401);
    expect(await prisma.session.count()).toBe(0); // and cleans them up
  });

  it('refuses state-changing requests from foreign origins (CSRF), allows the web origin', async () => {
    const c = await signup(app, 'alice');
    const evil = await c.post('/games', { title: 'Evil Game' }, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.body.error.code).toBe('FORBIDDEN_ORIGIN');
    expect((await c.post('/games', { title: 'Good Game' }, { origin: 'http://localhost:3000' })).status).toBe(201);
    expect((await c.get('/auth/me', { origin: 'https://evil.example' })).status).toBe(200); // reads are not state changing
  });

  it('tolerates an empty body with a JSON content type, rejects malformed JSON, and uses the error envelope', async () => {
    const c = await signup(app, 'alice');
    const empty = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { 'content-type': 'application/json', cookie: c.cookie } });
    expect(empty.statusCode).toBe(204);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_JSON');
    const missing = await app.inject({ method: 'GET', url: '/api/v1/nothing-here' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });
});
