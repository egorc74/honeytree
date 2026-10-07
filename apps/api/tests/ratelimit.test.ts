import { afterAll, describe, expect, it, vi } from 'vitest';

afterAll(() => vi.unstubAllEnvs());

describe('rate limiting', () => {
  it('throttles login attempts per IP with the standard error envelope', async () => {
    // The shared test config disables the limiter; load a fresh app with it switched on.
    vi.stubEnv('RATE_LIMIT_ENABLED', 'true');
    vi.resetModules();
    const { buildApp } = await import('../src/app.ts');
    const { prisma } = await import('../src/db.ts');
    const app = await buildApp();
    await app.ready();

    const attempt = () =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'nobody', password: 'wrong-password' } });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).statusCode);

    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const limited = await attempt();
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined();

    // ordinary reads are not affected by the auth limit
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);

    await app.close();
    await prisma.$disconnect();
  });
});
