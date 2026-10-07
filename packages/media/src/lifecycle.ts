import type { Db } from './db';
import { one } from './db';
import type { ObjectStorage } from './storage';
import { variantPrefix } from './keys';
import { getMedia, MEDIA_COLUMNS, type MediaRecord } from './repo';

export interface StoredVariants {
  [name: string]: { key: string; width: number; height: number; durationSec?: number };
}

/** Removes media rows and every stored object derived from them. */
export async function deleteMedia(db: Db, storage: ObjectStorage, ids: string[]): Promise<void> {
  for (const id of ids) {
    const media = await getMedia(db, id);
    if (!media) continue;
    // Clear references first so a foreign key can never block the delete.
    await db.query(`UPDATE games SET cover_media_id = NULL WHERE cover_media_id = $1`, [id]);
    await db.query(`UPDATE users SET avatar_media_id = NULL WHERE avatar_media_id = $1`, [id]);
    await db.query(`DELETE FROM media WHERE id = $1`, [id]);
    await storage.delete('private', media.storageKey);
    await storage.deletePrefix('public', variantPrefix(id));
  }
}

/**
 * Marks a media item `rejected` and removes the uploaded file. The reason is shown to the
 * uploader, so keep it user-presentable. Returns the updated row.
 */
export async function rejectMedia(
  db: Db,
  storage: ObjectStorage,
  mediaId: string,
  reason: string,
): Promise<MediaRecord | undefined> {
  const row = await one<MediaRecord>(
    db,
    `UPDATE media SET status = 'rejected',
       variants = COALESCE(variants, '{}'::jsonb) || jsonb_build_object('rejectReason', $2::text)
     WHERE id = $1 AND status <> 'ready'
     RETURNING ${MEDIA_COLUMNS}`,
    [mediaId, reason],
  );
  if (row) {
    await storage.delete('private', row.storageKey);
    await storage.deletePrefix('public', variantPrefix(mediaId));
  }
  return row;
}

/**
 * Marks media `ready` and applies the side effects of becoming ready:
 *  - cover:  `games.cover_media_id` points at it; the previous cover is deleted
 *  - video:  any previous video of the game is deleted
 *  - avatar: `users.avatar_media_id` points at it; the previous avatar is deleted
 * Returns undefined if the media was deleted or already finished in the meantime.
 */
export async function markReady(
  db: Db,
  storage: ObjectStorage,
  mediaId: string,
  variants: StoredVariants,
): Promise<MediaRecord | undefined> {
  const media = await one<MediaRecord>(
    db,
    `UPDATE media SET status = 'ready', variants = $2::jsonb
     WHERE id = $1 AND status IN ('scanning', 'processing')
     RETURNING ${MEDIA_COLUMNS}`,
    [mediaId, JSON.stringify(variants)],
  );
  if (!media) return undefined;

  if (media.kind === 'cover' && media.gameId) {
    await db.query(`UPDATE games SET cover_media_id = $2 WHERE id = $1`, [media.gameId, media.id]);
  } else if (media.kind === 'avatar') {
    await db.query(`UPDATE users SET avatar_media_id = $2 WHERE id = $1`, [
      media.ownerId,
      media.id,
    ]);
  }

  if (media.kind === 'cover' || media.kind === 'video' || media.kind === 'avatar') {
    const { rows } =
      media.kind === 'avatar'
        ? await db.query<{ id: string }>(
            `SELECT id FROM media WHERE owner_id = $1 AND kind = 'avatar' AND game_id IS NULL AND id <> $2 AND status = 'ready'`,
            [media.ownerId, media.id],
          )
        : await db.query<{ id: string }>(
            `SELECT id FROM media WHERE game_id = $1 AND kind = $2 AND id <> $3 AND status = 'ready'`,
            [media.gameId, media.kind, media.id],
          );
    await deleteMedia(
      db,
      storage,
      rows.map((r) => r.id),
    );
  }
  return media;
}
