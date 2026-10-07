import { getMedia, markReady, rejectMedia } from '@honeytree/media/core';
import type { WorkerContext } from '../context';

/** Scans an uploaded build with ClamAV. Clean builds become `ready`, infected ones `rejected`. */
export async function scanMedia(ctx: WorkerContext, mediaId: string): Promise<void> {
  const media = await getMedia(ctx.db, mediaId);
  if (!media || media.status !== 'scanning') {
    ctx.log.info('scan skipped', { mediaId, status: media?.status ?? 'missing' });
    return;
  }
  const stream = await ctx.storage.openReadStream('private', media.storageKey);
  const result = await ctx.scanner.scan(stream); // throws on scanner trouble => job is retried
  if (result.clean) {
    await markReady(ctx.db, ctx.storage, mediaId, {});
    ctx.log.info('build clean', { mediaId });
  } else {
    await rejectMedia(ctx.db, ctx.storage, mediaId, 'Malware detected. This file was removed.');
    ctx.log.warn('build infected', { mediaId, signature: result.signature });
  }
}
