import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupMedia } from '../src/processors/cleanup';
import { processImage } from '../src/processors/image';
import { scanMedia } from '../src/processors/scan';
import { processVideo } from '../src/processors/video';
import { createWorkerEnv, type WorkerEnv } from './helpers';

let env: WorkerEnv;
beforeEach(async () => {
  env = await createWorkerEnv();
});
afterEach(() => env.cleanup());

const png = (width: number, height: number, color = '#f5b700') =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

describe('scanMedia', () => {
  it('marks a clean build ready', async () => {
    const id = await env.addMedia('build', 'g.zip', Buffer.from('PK'));
    await scanMedia(env.ctx, id);
    expect((await env.row(id)).status).toBe('ready');
  });

  it('rejects an infected build and deletes the file', async () => {
    const infected = await createWorkerEnv({
      scan: async () => ({ clean: false, signature: 'Eicar-Test' }),
    });
    const id = await infected.addMedia('build', 'g.zip', Buffer.from('PK'));
    await scanMedia(infected.ctx, id);
    const row = await infected.row(id);
    expect(row.status).toBe('rejected');
    expect(row.variants.rejectReason).toMatch(/Malware/);
    expect(infected.storage.keys('private', 'uploads/')).toEqual([]);
    await infected.cleanup();
  });

  it('leaves the job to be retried when the scanner is down', async () => {
    const down = await createWorkerEnv({
      scan: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const id = await down.addMedia('build', 'g.zip', Buffer.from('PK'));
    await expect(scanMedia(down.ctx, id)).rejects.toThrow('ECONNREFUSED');
    expect((await down.row(id)).status).toBe('scanning');
    await down.cleanup();
  });

  it('ignores media that is no longer waiting for a scan', async () => {
    const id = await env.addMedia('build', 'g.zip', Buffer.from('PK'), 'uploading');
    await scanMedia(env.ctx, id);
    expect((await env.row(id)).status).toBe('uploading');
    await scanMedia(env.ctx, crypto.randomUUID()); // deleted meanwhile
  });
});

describe('processImage', () => {
  it('writes thumb/card/full WebP variants without enlarging', async () => {
    const id = await env.addMedia('screenshot', 's.png', await png(2400, 1200));
    await processImage(env.ctx, id);
    const row = await env.row(id);
    expect(row.status).toBe('ready');
    expect(row.variants.thumb).toMatchObject({
      key: `media/${id}/thumb.webp`,
      width: 320,
      height: 160,
    });
    expect(row.variants.card).toMatchObject({ width: 640, height: 320 });
    expect(row.variants.full).toMatchObject({ width: 1600, height: 800 });
    const full = env.storage.objects.get(`public/media/${id}/full.webp`)!;
    expect((await sharp(full).metadata()).format).toBe('webp');

    const small = await env.addMedia('screenshot', 'small.png', await png(400, 300));
    await processImage(env.ctx, small);
    expect((await env.row(small)).variants.full).toMatchObject({ width: 400, height: 300 });
  });

  it('crops covers to 16:9 and makes the cover the game cover, replacing the old one', async () => {
    const first = await env.addMedia('cover', 'c1.png', await png(1000, 1000));
    await processImage(env.ctx, first);
    expect((await env.row(first)).variants.card).toMatchObject({ width: 640, height: 360 });
    const game = () =>
      env.db.query<{ cover_media_id: string }>(`SELECT cover_media_id FROM games WHERE id=$1`, [
        env.gameId,
      ]);
    expect((await game()).rows[0]!.cover_media_id).toBe(first);

    const second = await env.addMedia('cover', 'c2.png', await png(1920, 1080, '#6b4226'));
    await processImage(env.ctx, second);
    expect((await game()).rows[0]!.cover_media_id).toBe(second);
    expect(await env.row(first)).toBeUndefined(); // old cover removed
    expect(env.storage.keys('public', `media/${first}`)).toEqual([]);
  });

  it('crops avatars to squares and points the user at them', async () => {
    const id = await env.addMedia('avatar', 'me.png', await png(900, 600));
    await processImage(env.ctx, id);
    expect((await env.row(id)).variants.thumb).toMatchObject({ width: 128, height: 128 });
    const u = await env.db.query<{ avatar_media_id: string }>(
      `SELECT avatar_media_id FROM users WHERE id=$1`,
      [env.userId],
    );
    expect(u.rows[0]!.avatar_media_id).toBe(id);
  });

  it('applies EXIF orientation', async () => {
    const rotated = await sharp(await png(600, 200))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const id = await env.addMedia('screenshot', 'r.jpg', rotated);
    await processImage(env.ctx, id);
    const v = (await env.row(id)).variants.full;
    expect(v.width).toBe(200);
    expect(v.height).toBe(600);
  });

  it('rejects data sharp cannot decode', async () => {
    const id = await env.addMedia(
      'screenshot',
      'bad.png',
      Buffer.from('\x89PNG\r\n\x1a\nnot really'),
    );
    await processImage(env.ctx, id);
    const row = await env.row(id);
    expect(row.status).toBe('rejected');
    expect(row.variants.rejectReason).toMatch(/could not be read/);
  });
});

describe('processVideo', () => {
  async function makeVideo(seconds: number, size: string) {
    const out = join(env.ctx.tmpDir, `src-${size}.mp4`);
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${size}:rate=15:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${seconds}`,
      '-c:v',
      'mpeg4',
      '-c:a',
      'aac',
      '-shortest',
      out,
    ]);
    return readFile(out);
  }

  it('encodes a 1080p clip to 720p H.264 and extracts a poster', async () => {
    const id = await env.addMedia('video', 't.mp4', await makeVideo(2, '1920x1080'));
    await processVideo(env.ctx, id);
    const row = await env.row(id);
    expect(row.status).toBe('ready');
    expect(row.variants.mp4_720p).toMatchObject({
      key: `media/${id}/video-720p.mp4`,
      width: 1280,
      height: 720,
    });
    expect(row.variants.mp4_720p.durationSec).toBeGreaterThan(1.5);
    expect(row.variants.poster).toMatchObject({ key: `media/${id}/poster.webp` });

    const mp4 = env.storage.objects.get(`public/media/${id}/video-720p.mp4`)!;
    const outPath = join(env.ctx.tmpDir, 'check.mp4');
    await import('node:fs/promises').then((fs) => fs.writeFile(outPath, mp4));
    const codec = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'csv=p=0',
      outPath,
    ])
      .toString()
      .trim();
    expect(codec).toBe('h264');
    expect(
      (await sharp(env.storage.objects.get(`public/media/${id}/poster.webp`)!).metadata()).format,
    ).toBe('webp');
  });

  it('does not upscale small videos', async () => {
    const id = await env.addMedia('video', 'small.mp4', await makeVideo(1, '640x360'));
    await processVideo(env.ctx, id);
    expect((await env.row(id)).variants.mp4_720p).toMatchObject({ width: 640, height: 360 });
  });

  it('rejects files ffprobe cannot read', async () => {
    const id = await env.addMedia('video', 'x.mp4', Buffer.from('definitely not a video'));
    await processVideo(env.ctx, id);
    expect((await env.row(id)).status).toBe('rejected');
  });
});

describe('cleanupMedia', () => {
  it('removes abandoned uploads and requeues stuck jobs', async () => {
    const stale = await env.addMedia('build', 'old.zip', Buffer.from('PK'), 'uploading');
    const fresh = await env.addMedia('build', 'new.zip', Buffer.from('PK'), 'uploading');
    const stuck = await env.addMedia('screenshot', 's.png', Buffer.from('x'), 'processing');
    const waiting = await env.addMedia('build', 'w.zip', Buffer.from('PK'), 'scanning');
    await env.db.query(`UPDATE media SET created_at = now() - interval '25 hours' WHERE id = $1`, [
      stale,
    ]);
    await env.db.query(
      `UPDATE media SET created_at = now() - interval '2 hours' WHERE id = ANY($1::uuid[])`,
      [[stuck, waiting]],
    );

    const result = await cleanupMedia(env.ctx);
    expect(result).toEqual({ deletedUploads: 1, requeued: 2 });
    expect(await env.row(stale)).toBeUndefined();
    expect(env.storage.keys('private', `uploads/${stale}`)).toEqual([]);
    expect(await env.row(fresh)).toBeDefined();
    expect(env.queue.jobs).toEqual(
      expect.arrayContaining([
        { queue: 'media-image', mediaId: stuck },
        { queue: 'media-scan', mediaId: waiting },
      ]),
    );
  });
});
