import type { Db } from '../db.ts';
import { notFound } from '../errors.ts';
import type { AuthUser } from '../http/auth.ts';
import { uuidParam } from '../http/validate.ts';

export type GameStub = { id: string; ownerId: string; status: string; likesCount: number };

const select = { id: true, ownerId: true, status: true, likesCount: true } as const;

/** A game that can be interacted with (liked, reviewed, commented): published only. */
export async function publishedGame(db: Db, rawId: string): Promise<GameStub> {
  const game = await db.game.findUnique({ where: { id: uuidParam(rawId, 'Game') }, select });
  if (!game || game.status !== 'published') throw notFound('Game');
  return game;
}

/** A game whose content may be read: published, or any status for its owner / admins. */
export async function readableGame(db: Db, rawId: string, viewer: AuthUser | null): Promise<GameStub> {
  const game = await db.game.findUnique({ where: { id: uuidParam(rawId, 'Game') }, select });
  const ok = game && (game.status === 'published' || (!!viewer && (viewer.id === game.ownerId || viewer.role === 'admin')));
  if (!game || !ok) throw notFound('Game');
  return game;
}
