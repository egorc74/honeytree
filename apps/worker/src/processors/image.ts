import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import {
  AVATAR_VARIANT_SIZES,
  IMAGE_VARIANT_SIZES,
  getMedia,
  markReady,
  rejectMedia,
  variantKey,
  type StoredVariants,
} from '@honeytree/media/core';
import type { WorkerContext } from '../context';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/** Turns an uploaded screenshot, cover or avatar into WebP variants in the public bucket. */
export async function processImage(ctx: WorkerContext, mediaId: string): Promise<void> {
  const media = await getMedia(ctx.db, mediaId);
  if (!media || media.status !== 'processing') {
    ctx.log.info('image skipped', { mediaId, status: media?.status ?? 'missing' });
    return;
  }
  const dir = await mkdtemp(join(ctx.tmpDir, 'img-'));
  try {
    const source = join(dir, 'original');
    await ctx.storage.downloadToFile('private', media.storageKey, source);

    let meta: Metadata;
    try {
      meta = await sharp(source).metadata();
    } catch {
      await rejectMedia(ctx.db, ctx.storage, mediaId, 'This image could not be read.');
      return;
    }
    if (!meta.width || !meta.height) {
      await rejectMedia(ctx.db, ctx.storage, mediaId, 'This image could not be read.');
      return;
    }

    const sizes = media.kind === 'avatar' ? AVATAR_VARIANT_SIZES : IMAGE_VARIANT_SIZES;
    const variants: StoredVariants = {};
    for (const [name, size] of Object.entries(sizes)) {
      // Avatars are square crops, covers are cropped to 16:9 so cards line up; screenshots keep
      // their own aspect ratio. Nothing is ever enlarged.
      const crop = media.kind === 'avatar' || media.kind === 'cover';
      const pipeline = sharp(source, { failOn: 'error' }).rotate(); // apply EXIF orientation
      const resized = crop
        ? pipeline.resize({
            width: size.width,
            height: size.height,
            fit: 'cover',
            position: 'attention',
            withoutEnlargement: true,
          })
        : pipeline.resize({ width: size.width, withoutEnlargement: true });
      const { data, info } = await resized
        .webp({ quality: name === 'thumb' ? 76 : 82 })
        .toBuffer({ resolveWithObject: true });
      const key = variantKey(mediaId, `${name}.webp`);
      await ctx.storage.putBuffer('public', key, data, {
        contentType: 'image/webp',
        cacheControl: IMMUTABLE,
      });
      variants[name] = { key, width: info.width, height: info.height };
    }
    await markReady(ctx.db, ctx.storage, mediaId, variants);
    ctx.log.info('image ready', { mediaId, kind: media.kind });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
