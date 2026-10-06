import { createHash, randomUUID } from 'node:crypto';
import type { Db } from './db';
import { MediaError, forbidden, notFound } from './errors';
import { originalKey } from './keys';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  KIND_RULES,
  MAX_PENDING_PER_KIND,
  MAX_PER_GAME,
  UPLOAD_URL_TTL_SECONDS,
  fileExtension,
  validateUploadRequest,
  type UploadRequest,
} from './limits';
import { HEAD_BYTES, TAIL_BYTES, matchesAny } from './magic';
import { queueForKind, type JobQueue } from './queue';
import {
  countMedia,
  getGame,
  getMedia,
  insertMedia,
  listGameMedia,
  MEDIA_COLUMNS,
  type MediaRecord,
} from './repo';
import { deleteMedia, rejectMedia } from './lifecycle';
import { one } from './db';
import type { ObjectStorage } from './storage';

export interface AuthUser {
  id: string;
  role: 'user' | 'admin';
}

export interface MediaServiceDeps {
  db: Db;
  storage: ObjectStorage;
  queue: JobQueue;
  ipHashSalt: string;
  now?: () => Date;
}

export interface UploadTicket {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  /** Always empty; kept for compatibility with the presigned-POST shape in PLAN.md. */
  fields: Record<string, never>;
  expiresAt: string;
  media: MediaRecord;
}

export type DownloadResult = { redirectUrl: string; counted: boolean } | { error: MediaError };

const canManage = (user: AuthUser, ownerId: string) => user.role === 'admin' || user.id === ownerId;

export class MediaService {
  constructor(private readonly deps: MediaServiceDeps) {}

  private get db() {
    return this.deps.db;
  }

  /** Step 1: validate the request, record the media row and hand out a presigned PUT URL. */
  async createUpload(
    user: AuthUser,
    target: { gameId: string } | { avatar: true },
    body: UploadRequest,
  ): Promise<UploadTicket> {
    const isAvatar = 'avatar' in target;
    if (isAvatar !== (body.kind === 'avatar')) {
      throw new MediaError(
        'INVALID_UPLOAD',
        400,
        isAvatar
          ? 'Only avatars can be uploaded here.'
          : 'Avatars are uploaded to your profile, not to a game.',
      );
    }
    const check = validateUploadRequest(body);
    if (!check.ok) throw new MediaError('INVALID_UPLOAD', 400, check.message);

    let gameId: string | null = null;
    if ('gameId' in target) {
      const game = await getGame(this.db, target.gameId);
      if (!game) throw new MediaError('GAME_NOT_FOUND', 404, 'Game not found.');
      if (!canManage(user, game.ownerId))
        throw forbidden('Only the creator can upload to this game.');
      gameId = game.id;
    }

    const scope = gameId ? { gameId } : { ownerId: user.id };
    const counts = await countMedia(this.db, scope, body.kind);
    const cap = MAX_PER_GAME[body.kind];
    if (cap !== undefined && counts.active >= cap) {
      throw new MediaError(
        'UPLOAD_LIMIT_REACHED',
        409,
        `A game can have at most ${cap} ${body.kind === 'build' ? 'builds' : 'screenshots'}.`,
      );
    }
    if (counts.pending >= MAX_PENDING_PER_KIND) {
      throw new MediaError(
        'UPLOAD_LIMIT_REACHED',
        429,
        'Too many unfinished uploads. Finish or cancel some first.',
      );
    }

    const id = randomUUID();
    const media = await insertMedia(this.db, {
      id,
      gameId,
      ownerId: user.id,
      kind: body.kind,
      storageKey: originalKey(id, body.filename),
      originalName: body.filename.slice(0, 255),
      mime: body.mime.trim().toLowerCase() || 'application/octet-stream',
      sizeBytes: body.size,
    });
    const signed = await this.deps.storage.presignPut('private', media.storageKey, {
      contentType: media.mime,
      contentLength: body.size,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      uploadId: media.id,
      url: signed.url,
      method: 'PUT',
      headers: signed.headers,
      fields: {},
      expiresAt: new Date(this.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      media,
    };
  }

  /**
   * Step 2: the browser says it is done. Check the object exists, has the declared size and
   * really looks like what its extension claims, then hand it to the worker.
   */
  async completeUpload(user: AuthUser, mediaId: string): Promise<MediaRecord> {
    const media = await this.requireOwned(user, mediaId);
    if (media.status !== 'uploading') return media; // idempotent: already completed

    const stored = await this.deps.storage.head('private', media.storageKey);
    if (!stored) {
      throw new MediaError('UPLOAD_NOT_RECEIVED', 409, 'The file has not arrived yet. Try again.');
    }
    const limit = KIND_RULES[media.kind].maxBytes;
    if (stored.size === 0 || stored.size > limit || stored.size !== media.sizeBytes) {
      await this.reject(media.id, 'The file size does not match what was announced.');
    }

    const rule = KIND_RULES[media.kind].extensions[fileExtension(media.originalName)];
    const head = await this.deps.storage.getRange(
      'private',
      media.storageKey,
      0,
      Math.min(HEAD_BYTES, stored.size) - 1,
    );
    const tail =
      stored.size > TAIL_BYTES
        ? await this.deps.storage.getRange(
            'private',
            media.storageKey,
            stored.size - TAIL_BYTES,
            stored.size - 1,
          )
        : head;
    if (!rule || !matchesAny(rule.types, head, tail)) {
      await this.reject(
        media.id,
        `The file content does not look like a ${fileExtension(media.originalName)} file.`,
      );
    }

    const next = media.kind === 'build' ? 'scanning' : 'processing';
    const updated = await one<MediaRecord>(
      this.db,
      `UPDATE media SET status = $2 WHERE id = $1 AND status = 'uploading'
       RETURNING ${MEDIA_COLUMNS}`,
      [media.id, next],
    );
    if (!updated) return (await getMedia(this.db, media.id)) ?? media; // raced with another call
    await this.deps.queue.enqueueMedia(queueForKind(media.kind), media.id);
    return updated;
  }

  private async reject(mediaId: string, reason: string): Promise<never> {
    await rejectMedia(this.db, this.deps.storage, mediaId, reason);
    throw new MediaError('UPLOAD_REJECTED', 422, reason);
  }

  async getUpload(user: AuthUser, mediaId: string): Promise<MediaRecord> {
    return this.requireOwned(user, mediaId);
  }

  async deleteMedia(user: AuthUser, mediaId: string): Promise<void> {
    const media = await this.requireOwned(user, mediaId);
    await deleteMedia(this.db, this.deps.storage, [media.id]);
  }

  /** Sets the order of a game's screenshots. `mediaIds` must be exactly the game's screenshots. */
  async reorderScreenshots(
    user: AuthUser,
    gameId: string,
    mediaIds: string[],
  ): Promise<MediaRecord[]> {
    const game = await getGame(this.db, gameId);
    if (!game) throw new MediaError('GAME_NOT_FOUND', 404, 'Game not found.');
    if (!canManage(user, game.ownerId)) throw forbidden('Only the creator can reorder media.');

    const current = await listGameMedia(this.db, gameId, 'screenshot');
    const known = new Set(current.map((m) => m.id));
    const requested = new Set(mediaIds);
    if (
      requested.size !== mediaIds.length ||
      requested.size !== known.size ||
      mediaIds.some((id) => !known.has(id))
    ) {
      throw new MediaError(
        'INVALID_UPLOAD',
        400,
        'mediaIds must list every screenshot of the game exactly once.',
      );
    }
    await this.db.query(
      `UPDATE media SET sort_order = o.position
       FROM unnest($2::uuid[]) WITH ORDINALITY AS o(id, position)
       WHERE media.id = o.id AND media.game_id = $1`,
      [gameId, mediaIds],
    );
    return listGameMedia(this.db, gameId, 'screenshot');
  }

  /**
   * Resolves a download: picks a ready build, records the download (once per user or IP
   * per 24 hours, never for the game's owner) and returns a short-lived signed URL.
   */
  async resolveDownload(
    user: AuthUser | null,
    gameId: string,
    opts: { mediaId?: string; ip: string },
  ): Promise<DownloadResult> {
    const game = await getGame(this.db, gameId);
    const isOwner = !!user && canManage(user, game?.ownerId ?? '');
    if (!game || (game.status !== 'published' && !isOwner)) {
      return { error: new MediaError('GAME_NOT_FOUND', 404, 'Game not found.') };
    }
    const builds = (await listGameMedia(this.db, gameId, 'build')).filter(
      (m) => m.status === 'ready' && (!opts.mediaId || m.id === opts.mediaId),
    );
    const build = builds[0];
    if (!build) {
      return {
        error: new MediaError('BUILD_NOT_AVAILABLE', 404, 'There is no downloadable build yet.'),
      };
    }

    let counted = false;
    if (!(user && user.id === game.ownerId)) {
      const ipHash = createHash('sha256')
        .update(`${this.deps.ipHashSalt}:${opts.ip}`)
        .digest('hex');
      const row = await one<{ downloadsCount: number }>(
        this.db,
        `WITH recent AS (
           SELECT 1 FROM downloads
           WHERE game_id = $1 AND created_at > now() - interval '24 hours'
             AND (($2::uuid IS NOT NULL AND user_id = $2::uuid) OR ip_hash = $3)
           LIMIT 1),
         ins AS (
           INSERT INTO downloads (game_id, user_id, ip_hash)
           SELECT $1, $2::uuid, $3 WHERE NOT EXISTS (SELECT 1 FROM recent)
           RETURNING id)
         UPDATE games SET downloads_count = downloads_count + 1
         WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)
         RETURNING downloads_count AS "downloadsCount"`,
        [gameId, user?.id ?? null, ipHash],
      );
      counted = !!row;
    }

    const redirectUrl = await this.deps.storage.presignGet('private', build.storageKey, {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      downloadName: build.originalName,
    });
    return { redirectUrl, counted };
  }

  private async requireOwned(user: AuthUser, mediaId: string): Promise<MediaRecord> {
    const media = await getMedia(this.db, mediaId);
    if (!media) throw notFound();
    if (!canManage(user, media.ownerId)) throw notFound(); // do not reveal other people's uploads
    return media;
  }

  private now() {
    return this.deps.now?.() ?? new Date();
  }
}
