import { one, type Db } from './db';
import type { MediaKind, MediaStatus } from './limits';

export interface MediaRecord {
  id: string;
  gameId: string | null;
  ownerId: string;
  kind: MediaKind;
  storageKey: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  status: MediaStatus;
  variants: Record<string, unknown>;
  sortOrder: number;
  createdAt: Date;
}

export const MEDIA_COLUMNS = `id, game_id AS "gameId", owner_id AS "ownerId", kind,
  storage_key AS "storageKey", original_name AS "originalName", mime,
  size_bytes::float8 AS "sizeBytes", status, variants, sort_order AS "sortOrder",
  created_at AS "createdAt"`;

export interface GameRef {
  id: string;
  ownerId: string;
  status: string;
}

export async function getGame(db: Db, id: string): Promise<GameRef | undefined> {
  return one<GameRef>(db, `SELECT id, owner_id AS "ownerId", status FROM games WHERE id = $1`, [
    id,
  ]);
}

export async function getMedia(db: Db, id: string): Promise<MediaRecord | undefined> {
  return one<MediaRecord>(db, `SELECT ${MEDIA_COLUMNS} FROM media WHERE id = $1`, [id]);
}

export async function listGameMedia(
  db: Db,
  gameId: string,
  kind: MediaKind,
): Promise<MediaRecord[]> {
  const { rows } = await db.query<MediaRecord>(
    `SELECT ${MEDIA_COLUMNS} FROM media WHERE game_id = $1 AND kind = $2
     ORDER BY sort_order, created_at`,
    [gameId, kind],
  );
  return rows;
}

/** Counts of media that still count towards per-game caps, by status group. */
export async function countMedia(
  db: Db,
  scope: { gameId: string } | { ownerId: string },
  kind: MediaKind,
): Promise<{ active: number; pending: number }> {
  const [column, value] =
    'gameId' in scope ? ['game_id', scope.gameId] : ['owner_id', scope.ownerId];
  const row = await one<{ active: string; pending: string }>(
    db,
    `SELECT count(*) FILTER (WHERE status <> 'rejected') AS active,
            count(*) FILTER (WHERE status = 'uploading') AS pending
     FROM media WHERE ${column} = $1 AND kind = $2
       ${'ownerId' in scope ? 'AND game_id IS NULL' : ''}`,
    [value, kind],
  );
  return { active: Number(row?.active ?? 0), pending: Number(row?.pending ?? 0) };
}

export async function insertMedia(
  db: Db,
  m: {
    id: string;
    gameId: string | null;
    ownerId: string;
    kind: MediaKind;
    storageKey: string;
    originalName: string;
    mime: string;
    sizeBytes: number;
  },
): Promise<MediaRecord> {
  const row = await one<MediaRecord>(
    db,
    `INSERT INTO media (id, game_id, owner_id, kind, storage_key, original_name, mime, size_bytes,
                        status, variants, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'uploading', '{}'::jsonb,
       COALESCE((SELECT max(sort_order) + 1 FROM media
                 WHERE game_id IS NOT DISTINCT FROM $2::uuid AND kind = $4
                   AND ($2::uuid IS NOT NULL OR owner_id = $3)), 0))
     RETURNING ${MEDIA_COLUMNS}`,
    [m.id, m.gameId, m.ownerId, m.kind, m.storageKey, m.originalName, m.mime, m.sizeBytes],
  );
  return row!;
}
