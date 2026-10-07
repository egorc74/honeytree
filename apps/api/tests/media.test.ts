import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { variantKeys } from '../src/http/serializers.ts';
import { addMedia, Client, makeApp, makeGame, prisma, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client; // creator
let bob: Client;
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
});

const ticket = (c: Client, gameId: string, kind: string, filename: string, mime: string, size = 5000) =>
  c.post(`/games/${gameId}/uploads`, { kind, filename, mime, size });

describe('media plugin inside the API (Agent 3 + Agent 1)', () => {
  it('issues upload tickets only to the game owner', async () => {
    const draft = (await alice.post('/games', { title: 'Upload Me' })).body.game;
    const ok = await ticket(alice, draft.id, 'screenshot', 'shot.png', 'image/png');
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ method: 'PUT', media: { kind: 'screenshot', status: 'uploading', gameId: draft.id } });
    expect(ok.body.uploadId).toBe(ok.body.media.id);

    expect((await ticket(bob, draft.id, 'screenshot', 'shot.png', 'image/png')).status).toBe(403);
    expect((await ticket(new Client(app), draft.id, 'screenshot', 'shot.png', 'image/png')).status).toBe(401);
    expect((await ticket(alice, draft.id, 'build', 'virus.exe.txt', 'text/plain')).body.error.code).toBe('INVALID_UPLOAD');
    expect((await alice.get(`/uploads/${ok.body.uploadId}`)).body.media.status).toBe('uploading');
  });

  it('a row the plugin created shows up on the owner’s game page (and stays hidden from others until ready)', async () => {
    const draft = (await alice.post('/games', { title: 'Pending Media' })).body.game;
    const t = await ticket(alice, draft.id, 'screenshot', 'shot.png', 'image/png');
    const asOwner = (await alice.get(`/games/${draft.slug}`)).body.game;
    expect(asOwner.screenshots.map((s: any) => [s.id, s.status])).toEqual([[t.body.uploadId, 'uploading']]);

    await prisma.game.update({ where: { id: draft.id }, data: { status: 'published', publishedAt: new Date() } });
    expect((await bob.get(`/games/${draft.slug}`)).body.game.screenshots).toEqual([]); // not ready: hidden from everyone else
  });

  it('serialises the worker’s object-shaped variants (and mp4_720p / rejectReason) without crashing any endpoint', async () => {
    const g = await makeGame(alice, { title: 'Processed Game' });
    const cover = await prisma.media.findUniqueOrThrow({ where: { id: g.coverId } });
    await prisma.media.update({
      where: { id: cover.id },
      data: {
        storageKey: 'covers/original.png',
        variants: { thumb: { key: 'covers/t.webp', width: 320, height: 180 }, card: { key: 'covers/c.webp', width: 640, height: 360 } },
      },
    });
    const video = await addMedia(g.id, alice.user.id, 'video');
    await prisma.media.update({
      where: { id: video.id },
      data: { storageKey: 'videos/v.mp4', variants: { mp4_720p: { key: 'videos/v720.mp4', width: 1280, height: 720, durationSec: 31.4 }, poster: { key: 'videos/p.webp', width: 1280, height: 720 } } },
    });
    const rejected = await addMedia(g.id, alice.user.id, 'screenshot', 'rejected');
    await prisma.media.update({ where: { id: rejected.id }, data: { variants: { rejectReason: 'Not an image' } } });

    const base = 'http://localhost:9000/honeytree'; // MEDIA_PUBLIC_BASE_URL in the test env
    const game = (await alice.get(`/games/${g.slug}`)).body.game;
    expect(game.coverUrl).toBe(`${base}/covers/c.webp`); // the 640px card variant
    expect(game.cover.variants).toEqual({ thumb: `${base}/covers/t.webp`, card: `${base}/covers/c.webp` });
    expect(game.video.variants).toEqual({ mp4: `${base}/videos/v720.mp4`, poster: `${base}/videos/p.webp` });
    expect(game.screenshots.find((s: any) => s.id === rejected.id)).toMatchObject({ status: 'rejected', rejectReason: 'Not an image', variants: {} });

    // every list that resolves covers must cope with the object shape
    for (const url of ['/feed', '/feed/buzzing', '/search?q=processed', '/users/alice/games', '/leaderboard?type=games&period=all', `/games/${g.slug}`]) {
      const res = await bob.get(url);
      expect(res.status, url).toBe(200);
    }
    expect((await bob.get('/feed')).body.items[0].game.coverUrl).toBe(`${base}/covers/c.webp`);
    expect(variantKeys(cover.variants)).toEqual([]);
    expect(variantKeys({ card: { key: 'a/c.webp' }, thumb: 'a/t.webp', rejectReason: 'x', junk: 5 })).toEqual(['a/c.webp', 'a/t.webp']);
  });

  it('downloads: redirects to a presigned URL and counts a user once', async () => {
    const g = await makeGame(alice, { title: 'Downloadable' });
    const before = (await bob.get(`/games/${g.slug}`)).body.game.downloadsCount;
    const first = await bob.get(`/games/${g.id}/download`);
    expect(first.status).toBe(302);
    expect(String(first.headers.location)).toMatch(/^http:\/\/storage\.test\//);
    await bob.get(`/games/${g.id}/download`); // same user, same day
    expect((await bob.get(`/games/${g.slug}`)).body.game.downloadsCount).toBe(before + 1);
    expect(await prisma.download.count({ where: { gameId: g.id } })).toBe(1);
    expect((await new Client(app).get('/games/00000000-0000-7000-8000-000000000000/download')).status).toBe(404);
  });
});
