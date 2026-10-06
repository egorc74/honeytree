import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '../db.ts';
import { forbidden, invalid, notFound } from '../errors.ts';
import { requireUser, type AuthUser } from '../http/auth.ts';
import { gameSummaryInclude, toGameDetail, type GameRow } from '../http/serializers.ts';
import { slugify, stripHtml } from '../http/text.ts';
import { isUuid, optionalText, parse, text, uuidParam } from '../http/validate.ts';
import { FEED_SEQUENCE_KEY, getRedis, invalidate } from '../redis.ts';
import { recomputeGamesCount, recomputeOwnerRating } from '../services/stats.ts';

const PLATFORMS = ['windows', 'mac', 'linux', 'web', 'android'] as const;

const tag = z
  .string()
  .transform((s) => stripHtml(s).trim().toLowerCase().replace(/\s+/g, '-'))
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9+#._-]{1,23}$/, 'tags are 2-24 characters: a-z, 0-9, + # . _ -'));

const fields = {
  title: text(3, 80),
  shortDescription: optionalText(160),
  description: optionalText(10_000),
  tags: z.array(tag).max(8).transform((a) => [...new Set(a)]),
  platforms: z.array(z.enum(PLATFORMS)).transform((a) => [...new Set(a)]),
  version: text(1, 20),
};

const createBody = z.object({
  title: fields.title,
  shortDescription: fields.shortDescription.default(''),
  description: fields.description.default(''),
  tags: fields.tags.default([]),
  platforms: fields.platforms.default([]),
  version: fields.version.default('1.0.0'),
});

const patchBody = z.object({
  title: fields.title.optional(),
  shortDescription: fields.shortDescription.optional(),
  description: fields.description.optional(),
  tags: fields.tags.optional(),
  platforms: fields.platforms.optional(),
  version: fields.version.optional(),
  coverMediaId: z.string().nullable().optional(),
});

const strictLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    if (!(await prisma.game.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export async function findGameRow(idOrSlug: string): Promise<GameRow | null> {
  return prisma.game.findUnique({
    where: isUuid(idOrSlug) ? { id: idOrSlug.toLowerCase() } : { slug: idOrSlug.toLowerCase() },
    include: gameSummaryInclude,
  });
}

const canSee = (g: { status: string; ownerId: string }, viewer: AuthUser | null) =>
  g.status === 'published' || (!!viewer && (viewer.id === g.ownerId || viewer.role === 'admin'));

/** Loads a game the viewer must own (404 when it does not exist, 403 when it is someone else's). */
async function ownedGame(id: string, user: AuthUser): Promise<GameRow> {
  const game = await findGameRow(uuidParam(id, 'Game'));
  if (!game || !canSee(game, user)) throw notFound('Game');
  if (game.ownerId !== user.id) throw forbidden('Only the creator can change this game');
  if (game.status === 'removed') throw forbidden('This game was removed by the moderators');
  return game;
}

export default async function gamesRoutes(app: FastifyInstance) {
  app.post('/games', { config: strictLimit }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(createBody, req.body);

    const create = async (slug: string) =>
      prisma.game.create({ data: { ...body, slug, ownerId: user.id }, include: gameSummaryInclude });
    const game = await create(await uniqueSlug(body.title)).catch((e: { code?: string }) => {
      if (e?.code === 'P2002') return create(`${slugify(body.title)}-${randomBytes(3).toString('hex')}`); // slug race
      throw e;
    });
    return reply.status(201).send({ game: await toGameDetail(game, req.user) });
  });

  app.get('/games/:idOrSlug', async (req) => {
    const { idOrSlug } = req.params as { idOrSlug: string };
    const game = await findGameRow(idOrSlug);
    if (!game || !canSee(game, req.user)) throw notFound('Game');
    return { game: await toGameDetail(game, req.user) };
  });

  app.patch('/games/:idOrSlug', { config: strictLimit }, async (req) => {
    const user = requireUser(req);
    const { idOrSlug } = req.params as { idOrSlug: string };
    const game = await ownedGame(idOrSlug, user);
    const { coverMediaId, ...rest } = parse(patchBody, req.body);

    const data: Prisma.GameUpdateInput = { ...rest };
    if (coverMediaId !== undefined) {
      if (coverMediaId === null) {
        if (game.status === 'published') throw invalid('A published game needs a cover', { missing: ['cover'] }, 'PUBLISH_REQUIREMENTS');
        data.coverMediaId = null;
      } else {
        if (!isUuid(coverMediaId)) throw invalid('coverMediaId: must be a UUID');
        const media = await prisma.media.findFirst({
          where: { id: coverMediaId, gameId: game.id, kind: 'cover', status: 'ready' },
          select: { id: true },
        });
        if (!media) throw invalid('coverMediaId: must be a ready cover upload of this game', undefined, 'INVALID_MEDIA');
        data.coverMediaId = media.id;
      }
    }

    const updated = await prisma.game.update({ where: { id: game.id }, data, include: gameSummaryInclude });
    return { game: await toGameDetail(updated, req.user) };
  });

  app.post('/games/:idOrSlug/publish', { config: strictLimit }, async (req) => {
    const user = requireUser(req);
    const { idOrSlug } = req.params as { idOrSlug: string };
    const game = await ownedGame(idOrSlug, user);
    if (game.status === 'published') return { game: await toGameDetail(game, req.user) };

    const [cover, screenshots, builds] = await Promise.all([
      game.coverMediaId
        ? prisma.media.count({ where: { id: game.coverMediaId, kind: 'cover', status: 'ready' } })
        : Promise.resolve(0),
      prisma.media.count({ where: { gameId: game.id, kind: 'screenshot', status: 'ready' } }),
      prisma.media.count({ where: { gameId: game.id, kind: 'build', status: 'ready' } }),
    ]);
    const missing = [
      game.title.trim().length >= 3 ? null : 'title',
      cover ? null : 'cover',
      screenshots ? null : 'screenshot',
      builds ? null : 'build',
    ].filter((x): x is string => x !== null);
    if (missing.length) throw invalid(`Cannot publish yet, missing: ${missing.join(', ')}`, { missing }, 'PUBLISH_REQUIREMENTS');

    // A re-publish keeps the original publishedAt, so unpublish/publish cycles cannot reset the "fresh" ranking.
    const updated = await prisma.$transaction(async (tx) => {
      const g = await tx.game.update({
        where: { id: game.id },
        data: { status: 'published', publishedAt: game.publishedAt ?? new Date() },
        include: gameSummaryInclude,
      });
      await recomputeGamesCount(tx, game.ownerId);
      return g;
    });
    await invalidate(FEED_SEQUENCE_KEY);
    return { game: await toGameDetail(updated, req.user) };
  });

  app.post('/games/:idOrSlug/unpublish', { config: strictLimit }, async (req) => {
    const user = requireUser(req);
    const { idOrSlug } = req.params as { idOrSlug: string };
    const game = await ownedGame(idOrSlug, user);
    if (game.status !== 'published') return { game: await toGameDetail(game, req.user) };

    const updated = await prisma.$transaction(async (tx) => {
      const g = await tx.game.update({ where: { id: game.id }, data: { status: 'unpublished' }, include: gameSummaryInclude });
      await recomputeGamesCount(tx, game.ownerId);
      return g;
    });
    await invalidate(FEED_SEQUENCE_KEY);
    return { game: await toGameDetail(updated, req.user) };
  });

  app.delete('/games/:idOrSlug', { config: strictLimit }, async (req, reply) => {
    const user = requireUser(req);
    const { idOrSlug } = req.params as { idOrSlug: string };
    const game = await ownedGame(idOrSlug, user);

    const media = await prisma.media.findMany({ where: { gameId: game.id }, select: { storageKey: true, variants: true } });
    const keys = media.flatMap((m) => [
      m.storageKey,
      ...Object.values((m.variants && typeof m.variants === 'object' ? m.variants : {}) as Record<string, string>),
    ]);

    await prisma.$transaction(async (tx) => {
      // Comment authors lose the likes their comments on this game received.
      const lost = await tx.comment.groupBy({
        by: ['userId'],
        where: { gameId: game.id, deletedAt: null, likesCount: { gt: 0 } },
        _sum: { likesCount: true },
      });
      for (const l of lost) {
        await tx.user.update({ where: { id: l.userId }, data: { likesReceivedTotal: { decrement: l._sum.likesCount ?? 0 } } });
      }
      await tx.user.update({ where: { id: game.ownerId }, data: { likesReceivedTotal: { decrement: game.likesCount } } });
      await tx.game.delete({ where: { id: game.id } }); // cascades to media rows, likes, reviews, comments, scores
      await recomputeGamesCount(tx, game.ownerId);
      await recomputeOwnerRating(tx, game.ownerId);
    });

    await invalidate(FEED_SEQUENCE_KEY);

    // The media rows are gone: hand the storage keys to the media worker (Agent 3) so the files get deleted.
    // Best effort: without Redis the keys are dropped and the orphan sweeper has to find them.
    try {
      if (keys.length) await getRedis()?.rpush('media:delete-queue', JSON.stringify({ gameId: game.id, keys, at: Date.now() }));
    } catch (e) {
      req.log.warn({ err: e }, 'could not queue media cleanup');
    }
    return reply.status(204).send();
  });
}
