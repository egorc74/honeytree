import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from './helpers.ts';

let app: FastifyInstance;
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());

describe('system', () => {
  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('answers CORS preflights for the web origin with credentials, and not for others', async () => {
    const ok = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/games',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(String(ok.headers['access-control-allow-methods'])).toMatch(/PATCH/);

    const evil = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/games',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves deterministic placeholder images and rejects anything else', async () => {
    const a = await app.inject({ method: 'GET', url: '/placeholders/cover-1.svg' });
    const b = await app.inject({ method: 'GET', url: '/placeholders/cover-1.svg' });
    const c = await app.inject({ method: 'GET', url: '/placeholders/cover-2.svg' });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(a.headers['cache-control']).toMatch(/immutable/);
    expect(a.body).toMatch(/^<svg /);
    expect(a.body).toBe(b.body);
    expect(a.body).not.toBe(c.body);
    expect((await app.inject({ method: 'GET', url: '/placeholders/..%2Fsecret.svg' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/placeholders/x.png' })).statusCode).toBe(404);
  });
});
