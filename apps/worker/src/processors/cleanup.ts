import {
  ABANDONED_UPLOAD_HOURS,
  deleteMedia,
  queueForKind,
  type MediaKind,
} from '@honeytree/media/core';
import type { WorkerContext } from '../context';

/** After this long without finishing, `scanning`/`processing` media is queued again. */
const STUCK_MINUTES = 30;

export interface CleanupResult {
  deletedUploads: number;
  requeued: number;
}

/**
 * Hourly housekeeping for the media pipeline:
 *  - uploads still `uploading` after 24 h are abandoned: delete the row and any stored bytes
 *  - media stuck in `scanning`/`processing` (a job lost with a Redis restart, say) is queued
 *    again. Job ids equal media ids, so this is a no-op while a job really exists.
 */
export async function cleanupMedia(ctx: WorkerContext): Promise<CleanupResult> {
  const abandoned = await ctx.db.query<{ id: string }>(
    `SELECT id FROM media
     WHERE status = 'uploading' AND created_at < now() - ($1 || ' hours')::interval`,
    [String(ABANDONED_UPLOAD_HOURS)],
  );
  await deleteMedia(
    ctx.db,
    ctx.storage,
    abandoned.rows.map((r) => r.id),
  );

  const stuck = await ctx.db.query<{ id: string; kind: MediaKind }>(
    `SELECT id, kind FROM media
     WHERE status IN ('scanning', 'processing')
       AND created_at < now() - ($1 || ' minutes')::interval`,
    [String(STUCK_MINUTES)],
  );
  for (const m of stuck.rows) {
    await ctx.queue.enqueueMedia(queueForKind(m.kind), m.id);
  }
  return { deletedUploads: abandoned.rows.length, requeued: stuck.rows.length };
}
