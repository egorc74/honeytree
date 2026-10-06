import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '../db.ts';
import { forbidden, invalid, notFound } from '../errors.ts';
import { requireUser } from '../http/auth.ts';
import { decodeCursor, encodeCursor, pageQuery, slicePage } from '../http/pagination.ts';
import { toComment, userLiteSelect, userSummaryMap } from '../http/serializers.ts';
import { isUuid, parse, text, uuidParam } from '../http/validate.ts';
import { publishedGame, readableGame } from '../services/access.ts';
import { awardKarma, revokeKarma } from '../services/karma.ts';

const MAX_REPLIES_SHOWN = 50;

const listQuery = pageQuery().extend({
  kind: z.enum(['all', 'comment', 'suggestion']).default('all'),
  sort: z.enum(['top', 'new']).default('top'),
});

const createBody = z.object({
  body: text(1, 2000),
  kind: z.enum(['comment', 'suggestion']).default('comment'),
  parentId: z.string().optional(),
});

const writeLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const withUser = { user: { select: userLiteSelect } } satisfies Prisma.CommentInclude;

type Cursor = { l?: number; t: string; id: string };

export default async function commentsRoutes(app: FastifyInstance) {
  app.get('/games/:id/comments', async (req) => {
    const { id } = req.params as { id: string };
    const q = parse(listQuery, req.query);
    const game = await readableGame(prisma, id, req.user);

    const cursor = decodeCursor<Cursor>(q.cursor);
    const conditions: Prisma.CommentWhereInput[] = [
      // A deleted top-level comment stays visible (as a tombstone) only while it still has replies.
      { OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }] },
    ];
    if (cursor) {
      const t = new Date(cursor.t);
      conditions.push(
        q.sort === 'top'
          ? {
              OR: [
                { likesCount: { lt: cursor.l ?? 0 } },
                { likesCount: cursor.l ?? 0, createdAt: { lt: t } },
                { likesCount: cursor.l ?? 0, createdAt: t, id: { lt: cursor.id } },
              ],
            }
          : { OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: cursor.id } }] },
      );
    }
    const orderBy: Prisma.CommentOrderByWithRelationInput[] =
      q.sort === 'top'
        ? [{ likesCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }];

    const rows = await prisma.comment.findMany({
      where: { gameId: game.id, parentId: null, ...(q.kind !== 'all' && { kind: q.kind }), AND: conditions },
      include: withUser,
      orderBy,
      take: q.limit + 1,
    });
    const { items: parents, hasMore } = slicePage(rows, q.limit);

    const replies = parents.length
      ? await prisma.comment.findMany({
          where: { parentId: { in: parents.map((p) => p.id) }, deletedAt: null },
          include: withUser,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    const byParent = new Map<string, typeof replies>();
    for (const r of replies) byParent.set(r.parentId!, [...(byParent.get(r.parentId!) ?? []), r]);

    const all = [...parents, ...replies];
    const [users, likes] = await Promise.all([
      userSummaryMap(all.map((c) => c.user)),
      req.user && all.length
        ? prisma.commentLike.findMany({ where: { userId: req.user.id, commentId: { in: all.map((c) => c.id) } }, select: { commentId: true } })
        : Promise.resolve([]),
    ]);
    const liked = new Set(likes.map((l) => l.commentId));

    const last = parents.at(-1);
    return {
      items: parents.map((p) => {
        const mine = byParent.get(p.id) ?? [];
        return {
          ...toComment(p, users, liked),
          replies: mine.slice(0, MAX_REPLIES_SHOWN).map((r) => toComment(r, users, liked)),
          repliesCount: mine.length,
        };
      }),
      nextCursor:
        hasMore && last
          ? encodeCursor({ l: last.likesCount, t: last.createdAt.toISOString(), id: last.id } satisfies Cursor)
          : null,
    };
  });

  app.post('/games/:id/comments', { config: writeLimit }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = parse(createBody, req.body);

    const result = await prisma.$transaction(async (tx) => {
      const game = await publishedGame(tx, id);

      let parent: { id: string; userId: string } | null = null;
      if (body.parentId !== undefined) {
        if (!isUuid(body.parentId)) throw invalid('parentId: must be a UUID');
        if (body.kind === 'suggestion') throw invalid('Replies cannot be suggestions', undefined, 'INVALID_REPLY');
        const p = await tx.comment.findUnique({
          where: { id: body.parentId.toLowerCase() },
          select: { id: true, userId: true, gameId: true, parentId: true, deletedAt: true },
        });
        if (!p || p.gameId !== game.id || p.deletedAt) throw invalid('parentId: comment not found on this game', undefined, 'INVALID_REPLY');
        if (p.parentId) throw invalid('Replies are one level deep: reply to the top-level comment', undefined, 'INVALID_REPLY');
        parent = p;
      }

      const comment = await tx.comment.create({
        data: { gameId: game.id, userId: user.id, parentId: parent?.id ?? null, kind: body.kind, body: body.body },
        include: withUser,
      });
      await tx.game.update({ where: { id: game.id }, data: { commentsCount: { increment: 1 } } });

      // No karma for engaging with your own game or your own comment thread.
      const own = game.ownerId === user.id || parent?.userId === user.id;
      const karmaAwarded = own
        ? 0
        : await awardKarma(tx, {
            userId: user.id,
            reason: body.kind === 'suggestion' ? 'suggestion' : 'comment',
            refType: 'comment',
            refId: comment.id,
          });
      return { comment, karmaAwarded };
    });

    const users = await userSummaryMap([result.comment.user]);
    const view = toComment(result.comment, users, new Set());
    return reply.status(201).send({
      comment: { ...view, ...(view.parentId ? {} : { replies: [], repliesCount: 0 }) },
      karmaAwarded: result.karmaAwarded,
    });
  });

  app.delete('/comments/:id', { config: writeLimit }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    return prisma.$transaction(async (tx) => {
      const c = await tx.comment.findUnique({
        where: { id: uuidParam(id, 'Comment') },
        include: { game: { select: { ownerId: true } } },
      });
      if (!c) throw notFound('Comment');
      if (c.userId !== user.id && c.game.ownerId !== user.id && user.role !== 'admin') {
        throw forbidden('Only the author, the game creator or a moderator can delete this comment');
      }
      if (c.deletedAt) return { karmaAwarded: 0 }; // idempotent

      await tx.comment.update({ where: { id: c.id }, data: { deletedAt: new Date(), body: '' } });
      await tx.game.update({ where: { id: c.gameId }, data: { commentsCount: { decrement: 1 } } });
      if (c.likesCount > 0) {
        await tx.user.update({ where: { id: c.userId }, data: { likesReceivedTotal: { decrement: c.likesCount } } });
      }

      // The author loses what the comment earned them (including a suggestion bonus).
      const reason = c.kind === 'suggestion' ? 'suggestion' : 'comment';
      let revoked = await revokeKarma(tx, { userId: c.userId, reason, refType: 'comment', refId: c.id });
      if (c.acceptedAt) {
        revoked += await revokeKarma(tx, { userId: c.userId, reason: 'suggestion_accepted', refType: 'comment', refId: c.id });
      }
      return { karmaAwarded: c.userId === user.id ? revoked : 0 };
    });
  });

  // ------------------------------------------------------------ accepting suggestions (game creator only)
  const accept = (accepting: boolean) => async (req: import('fastify').FastifyRequest) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };

    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.comment.findUnique({
        where: { id: uuidParam(id, 'Comment') },
        include: { ...withUser, game: { select: { ownerId: true } } },
      });
      if (!c || c.deletedAt) throw notFound('Comment');
      if (c.game.ownerId !== user.id) throw forbidden('Only the creator of the game can accept suggestions');
      if (c.kind !== 'suggestion' || c.parentId) throw invalid('Only top-level suggestions can be accepted', undefined, 'NOT_A_SUGGESTION');
      if (c.userId === user.id) throw invalid('You cannot accept your own suggestion', undefined, 'OWN_SUGGESTION');

      const key = { userId: c.userId, reason: 'suggestion_accepted', refType: 'comment', refId: c.id } as const;
      if (accepting && !c.acceptedAt) {
        await tx.comment.update({ where: { id: c.id }, data: { acceptedAt: new Date() } });
        await awardKarma(tx, key);
      } else if (!accepting && c.acceptedAt) {
        await tx.comment.update({ where: { id: c.id }, data: { acceptedAt: null } });
        await revokeKarma(tx, key);
      }
      return tx.comment.findUniqueOrThrow({ where: { id: c.id }, include: withUser });
    });

    const [users, like] = await Promise.all([
      userSummaryMap([updated.user]),
      prisma.commentLike.findUnique({ where: { userId_commentId: { userId: user.id, commentId: updated.id } } }),
    ]);
    return { comment: toComment(updated, users, new Set(like ? [updated.id] : [])) };
  };

  app.post('/comments/:id/accept', { config: writeLimit }, accept(true));
  app.delete('/comments/:id/accept', { config: writeLimit }, accept(false));
}
