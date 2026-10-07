import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.ts';
import { notFound, selfAction } from '../errors.ts';
import { requireUser } from '../http/auth.ts';
import { uuidParam } from '../http/validate.ts';
import { publishedGame } from '../services/access.ts';
import { awardKarma, revokeKarma } from '../services/karma.ts';

const writeLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

export default async function likesRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------ games
  app.put('/games/:id/like', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const game = await publishedGame(tx, id);
      if (game.ownerId === user.id) throw selfAction('You cannot like your own game');

      const created = await tx.gameLike.createMany({ data: [{ userId: user.id, gameId: game.id }], skipDuplicates: true });
      if (created.count === 0) return { liked: true, likesCount: game.likesCount, karmaAwarded: 0 }; // already liked

      const updated = await tx.game.update({ where: { id: game.id }, data: { likesCount: { increment: 1 } }, select: { likesCount: true } });
      await tx.user.update({ where: { id: game.ownerId }, data: { likesReceivedTotal: { increment: 1 } } });
      const karmaAwarded = await awardKarma(tx, { userId: user.id, reason: 'like_game', refType: 'game', refId: game.id });
      return { liked: true, likesCount: updated.likesCount, karmaAwarded };
    });
  });

  app.delete('/games/:id/like', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const game = await publishedGame(tx, id);
      const removed = await tx.gameLike.deleteMany({ where: { userId: user.id, gameId: game.id } });
      if (removed.count === 0) return { liked: false, likesCount: game.likesCount, karmaAwarded: 0 }; // was not liked

      const updated = await tx.game.update({ where: { id: game.id }, data: { likesCount: { decrement: 1 } }, select: { likesCount: true } });
      await tx.user.update({ where: { id: game.ownerId }, data: { likesReceivedTotal: { decrement: 1 } } });
      const karmaAwarded = await revokeKarma(tx, { userId: user.id, reason: 'like_game', refType: 'game', refId: game.id });
      return { liked: false, likesCount: updated.likesCount, karmaAwarded };
    });
  });

  // ------------------------------------------------------------ comments
  const likeableComment = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], rawId: string) => {
    const comment = await tx.comment.findUnique({
      where: { id: uuidParam(rawId, 'Comment') },
      select: { id: true, userId: true, likesCount: true, deletedAt: true, game: { select: { status: true } } },
    });
    if (!comment || comment.deletedAt || comment.game.status !== 'published') throw notFound('Comment');
    return comment;
  };

  app.put('/comments/:id/like', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const comment = await likeableComment(tx, id);
      if (comment.userId === user.id) throw selfAction('You cannot like your own comment');

      const created = await tx.commentLike.createMany({ data: [{ userId: user.id, commentId: comment.id }], skipDuplicates: true });
      if (created.count === 0) return { liked: true, likesCount: comment.likesCount, karmaAwarded: 0 };

      const updated = await tx.comment.update({ where: { id: comment.id }, data: { likesCount: { increment: 1 } }, select: { likesCount: true } });
      await tx.user.update({ where: { id: comment.userId }, data: { likesReceivedTotal: { increment: 1 } } });
      const karmaAwarded = await awardKarma(tx, { userId: user.id, reason: 'like_comment', refType: 'comment', refId: comment.id });
      return { liked: true, likesCount: updated.likesCount, karmaAwarded };
    });
  });

  app.delete('/comments/:id/like', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const comment = await likeableComment(tx, id);
      const removed = await tx.commentLike.deleteMany({ where: { userId: user.id, commentId: comment.id } });
      if (removed.count === 0) return { liked: false, likesCount: comment.likesCount, karmaAwarded: 0 };

      const updated = await tx.comment.update({ where: { id: comment.id }, data: { likesCount: { decrement: 1 } }, select: { likesCount: true } });
      await tx.user.update({ where: { id: comment.userId }, data: { likesReceivedTotal: { decrement: 1 } } });
      const karmaAwarded = await revokeKarma(tx, { userId: user.id, reason: 'like_comment', refType: 'comment', refId: comment.id });
      return { liked: false, likesCount: updated.likesCount, karmaAwarded };
    });
  });
}
