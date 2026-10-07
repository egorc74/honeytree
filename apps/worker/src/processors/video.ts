import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  getMedia,
  markReady,
  rejectMedia,
  variantKey,
  type StoredVariants,
} from '@honeytree/media/core';
import type { WorkerContext } from '../context';
import { run } from '../exec';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_DURATION_SECONDS = 15 * 60;
const ENCODE_TIMEOUT_MS = 20 * 60 * 1000;

interface Probe {
  width: number;
  height: number;
  durationSec: number;
}

async function probe(ctx: WorkerContext, file: string): Promise<Probe | null> {
  try {
    const { stdout } = await run(
      ctx.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
      { timeoutMs: 60_000 },
    );
    const info = JSON.parse(stdout) as {
      streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
      format?: { duration?: string };
    };
    const video = info.streams?.find((s) => s.codec_type === 'video');
    if (!video?.width || !video.height) return null;
    const durationSec = Number(info.format?.duration ?? video.duration ?? 0);
    return { width: video.width, height: video.height, durationSec };
  } catch {
    return null;
  }
}

/** Encodes an uploaded trailer to H.264/AAC MP4 at up to 720p and extracts a poster frame. */
export async function processVideo(ctx: WorkerContext, mediaId: string): Promise<void> {
  const media = await getMedia(ctx.db, mediaId);
  if (!media || media.status !== 'processing') {
    ctx.log.info('video skipped', { mediaId, status: media?.status ?? 'missing' });
    return;
  }
  const dir = await mkdtemp(join(ctx.tmpDir, 'vid-'));
  try {
    const source = join(dir, 'original');
    await ctx.storage.downloadToFile('private', media.storageKey, source);

    const input = await probe(ctx, source);
    if (!input || input.durationSec <= 0) {
      await rejectMedia(ctx.db, ctx.storage, mediaId, 'This video could not be read.');
      return;
    }
    if (input.durationSec > MAX_DURATION_SECONDS) {
      await rejectMedia(ctx.db, ctx.storage, mediaId, 'Trailers can be at most 15 minutes long.');
      return;
    }

    const output = join(dir, 'video.mp4');
    await run(
      ctx.ffmpegPath,
      [
        '-y',
        '-i',
        source,
        // Downscale to at most 720 lines, keep the aspect ratio, force even dimensions.
        '-vf',
        "scale=-2:'min(720,ih)'",
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-map_metadata',
        '-1',
        output,
      ],
      { timeoutMs: ENCODE_TIMEOUT_MS },
    );
    const encoded = await probe(ctx, output);
    if (!encoded) throw new Error('ffmpeg produced an unreadable file');

    const posterPng = join(dir, 'poster.png');
    const posterAt = Math.min(1, input.durationSec / 2);
    await run(
      ctx.ffmpegPath,
      ['-y', '-ss', String(posterAt), '-i', output, '-frames:v', '1', posterPng],
      { timeoutMs: 120_000 },
    );
    const poster = await sharp(await readFile(posterPng))
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    const videoKey = variantKey(mediaId, 'video-720p.mp4');
    const posterKey = variantKey(mediaId, 'poster.webp');
    await ctx.storage.putFile('public', videoKey, output, {
      contentType: 'video/mp4',
      cacheControl: IMMUTABLE,
    });
    await ctx.storage.putBuffer('public', posterKey, poster.data, {
      contentType: 'image/webp',
      cacheControl: IMMUTABLE,
    });

    const variants: StoredVariants = {
      mp4_720p: {
        key: videoKey,
        width: encoded.width,
        height: encoded.height,
        durationSec: Math.round(encoded.durationSec * 10) / 10,
      },
      poster: { key: posterKey, width: poster.info.width, height: poster.info.height },
    };
    await markReady(ctx.db, ctx.storage, mediaId, variants);
    ctx.log.info('video ready', { mediaId, durationSec: encoded.durationSec });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
