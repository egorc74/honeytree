import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Db } from '../db.ts';
import { conflict, forbidden, notFound, selfAction } from '../errors.ts';
import { requireUser } from '../http/auth.ts';
import { decodeCursor, encodeCursor, pageQuery, slicePage } from '../http/pagination.ts';
import { toReviews, userLiteSelect } from '../http/serializers.ts';
import { optionalText, parse, uuidParam } from '../http/validate.ts';
import { publishedGame, readableGame } from '../services/access.ts';
import { awardKarma, revokeKarma } from '../services/karma.ts';
import { recomputeRatings } from '../services/stats.ts';

const MIN_BODY_FOR_KARMA = 20;

const rating = z.number().int().min(1).max(5);
const createBody = z.object({ rating, body: optionalText(4000).default('') });
const patchBody = z.object({ rating: rating.optional(), body: optionalText(4000).optional() });

const writeLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

/** Reviews earn karma only with a real text, and never on your own game (which cannot be reviewed anyway). */
async function syncReviewKarma(tx: Db, review: { id: string; userId: string; body: string }) {
  const key = { userId: review.userId, reason: 'review', refType: 'review', refId: review.id } as const;
  return review.body.trim().length >= MIN_BODY_FOR_KARMA ? awardKarma(tx, key) : revokeKarma(tx, key);
}

export default async function reviewsRoutes(app: FastifyInstance) {
  app.get('/games/:id/reviews', async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(pageQuery(), req.query);
    const game = await readableGame(prisma, id, req.user);

    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    const after = cursor
      ? { OR: [{ createdAt: { lt: new Date(cursor.t) } }, { createdAt: new Date(cursor.t), id: { lt: cursor.id } }] }
      : {};

    const [rows, groups, g] = await Promise.all([
      prisma.review.findMany({
        where: { gameId: game.id, ...after },
        include: { user: { select: userLiteSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      }),
      prisma.review.groupBy({ by: ['rating'], where: { gameId: game.id }, _count: { _all: true } }),
      prisma.game.findUniqueOrThrow({ where: { id: game.id }, select: { ratingAvg: true, reviewsCount: true } }),
    ]);

    const { items, hasMore } = slicePage(rows, q.limit);
    const last = items.at(-1);
    const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
    for (const grp of groups) distribution[String(grp.rating)] = grp._count._all;

    return {
      items: await toReviews(items),
      nextCursor: hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
      summary: { ratingAvg: g.ratingAvg, ratingCount: g.reviewsCount, distribution },
    };
  });

  app.post('/games/:id/reviews', { config: writeLimit }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parse(createBody, req.body);

    const result = await prisma.$transaction(async (tx) => {
      const game = await publishedGame(tx, id);
      if (game.ownerId === user.id) throw selfAction('You cannot review your own game');
      if (await tx.review.findUnique({ where: { gameId_userId: { gameId: game.id, userId: user.id } }, select: { id: true } })) {
        throw conflict('ALREADY_REVIEWED', 'You already reviewed this game, edit your review instead');
      }

      const review = await tx.review.create({
        data: { gameId: game.id, userId: user.id, rating: body.rating, body: body.body },
        include: { user: { select: userLiteSelect } },
      });
      await recomputeRatings(tx, game.id, game.ownerId);
      const karmaAwarded = await syncReviewKarma(tx, review);
      return { review, karmaAwarded };
    });
    return reply.status(201).send({ review: (await toReviews([result.review]))[0], karmaAwarded: result.karmaAwarded });
  });

  app.patch('/reviews/:id', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parse(patchBody, req.body);

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.review.findUnique({
        where: { id: uuidParam(id, 'Review') },
        include: { game: { select: { ownerId: true } } },
      });
      if (!existing) throw notFound('Review');
      if (existing.userId !== user.id) throw forbidden('You can only edit your own review');

      const review = await tx.review.update({
        where: { id: existing.id },
        data: { ...(body.rating !== undefined && { rating: body.rating }), ...(body.body !== undefined && { body: body.body }) },
        include: { user: { select: userLiteSelect } },
      });
      await recomputeRatings(tx, existing.gameId, existing.game.ownerId);
      const karmaAwarded = await syncReviewKarma(tx, review);
      return { review, karmaAwarded };
    });
    return { review: (await toReviews([result.review]))[0], karmaAwarded: result.karmaAwarded };
  });

  app.delete('/reviews/:id', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const review = await tx.review.findUnique({
        where: { id: uuidParam(id, 'Review') },
        include: { game: { select: { ownerId: true } } },
      });
      if (!review) throw notFound('Review');
      if (review.userId !== user.id && user.role !== 'admin') throw forbidden('You can only delete your own review');

      await tx.review.delete({ where: { id: review.id } });
      await recomputeRatings(tx, review.gameId, review.game.ownerId);
      const revoked = await revokeKarma(tx, { userId: review.userId, reason: 'review', refType: 'review', refId: review.id });
      // `karmaAwarded` reports the caller's own karma change
      return { karmaAwarded: review.userId === user.id ? revoked : 0 };
    });
  });
}
