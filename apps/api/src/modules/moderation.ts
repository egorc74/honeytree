import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { notFound } from '../errors.ts';
import { requireAdmin, requireUser } from '../http/auth.ts';
import { decodeCursor, encodeCursor, pageQuery, slicePage } from '../http/pagination.ts';
import { userLiteSelect, userSummaryMap } from '../http/serializers.ts';
import { parse, text, uuidParam } from '../http/validate.ts';
import { FEED_SEQUENCE_KEY, invalidate } from '../redis.ts';
import { recomputeGamesCount } from '../services/stats.ts';

const reportBody = z.object({
  targetType: z.enum(['game', 'comment', 'review', 'user']),
  targetId: z.string(),
  reason: text(3, 500),
});

async function targetExists(type: z.infer<typeof reportBody>['targetType'], id: string) {
  const where = { id };
  switch (type) {
    case 'game': return !!(await prisma.game.findUnique({ where, select: { id: true } }));
    case 'comment': return !!(await prisma.comment.findUnique({ where, select: { id: true } }));
    case 'review': return !!(await prisma.review.findUnique({ where, select: { id: true } }));
    case 'user': return !!(await prisma.user.findUnique({ where, select: { id: true } }));
  }
}

export default async function moderationRoutes(app: FastifyInstance) {
  app.post('/reports', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = requireUser(req);
    const body = parse(reportBody, req.body);
    const targetId = uuidParam(body.targetId, 'Target');
    if (!(await targetExists(body.targetType, targetId))) throw notFound('Target');

    // Reporting the same thing twice while the first report is open is a no-op.
    const existing = await prisma.report.findFirst({
      where: { reporterId: user.id, targetType: body.targetType, targetId, status: 'open' },
      select: { id: true },
    });
    const report =
      existing ??
      (await prisma.report.create({
        data: { reporterId: user.id, targetType: body.targetType, targetId, reason: body.reason },
        select: { id: true },
      }));
    return reply.status(201).send({ report: { id: report.id } });
  });

  app.get('/admin/reports', async (req) => {
    requireAdmin(req);
    const q = parse(pageQuery().extend({ status: z.enum(['open', 'resolved']).default('open') }), req.query);
    const cursor = decodeCursor<{ t: string; id: string }>(q.cursor);
    const after = cursor
      ? { OR: [{ createdAt: { lt: new Date(cursor.t) } }, { createdAt: new Date(cursor.t), id: { lt: cursor.id } }] }
      : {};

    const rows = await prisma.report.findMany({
      where: { status: q.status, ...after },
      include: { reporter: { select: userLiteSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { items, hasMore } = slicePage(rows, q.limit);
    const reporters = await userSummaryMap(items.map((r) => r.reporter));
    const last = items.at(-1);
    return {
      items: items.map((r) => ({
        id: r.id,
        targetType: r.targetType,
        targetId: r.targetId,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reporter: reporters.get(r.reporter.id)!,
      })),
      nextCursor: hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
    };
  });

  app.post('/admin/reports/:id/resolve', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const report = await prisma.report.findUnique({ where: { id: uuidParam(id, 'Report') }, select: { id: true } });
    if (!report) throw notFound('Report');
    await prisma.report.update({ where: { id: report.id }, data: { status: 'resolved' } });
    return { report: { id: report.id, status: 'resolved' } };
  });

  const setStatus = (status: 'removed' | 'unpublished') => async (req: import('fastify').FastifyRequest) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const game = await prisma.game.findUnique({ where: { id: uuidParam(id, 'Game') }, select: { id: true, ownerId: true, status: true } });
    if (!game) throw notFound('Game');
    // `restore` only applies to removed games; it never publishes anything on its own.
    if (status === 'unpublished' && game.status !== 'removed') return { game: { id: game.id, status: game.status } };

    await prisma.$transaction(async (tx) => {
      await tx.game.update({ where: { id: game.id }, data: { status } });
      await recomputeGamesCount(tx, game.ownerId);
    });
    await invalidate(FEED_SEQUENCE_KEY);
    return { game: { id: game.id, status } };
  };
  app.post('/admin/games/:id/remove', setStatus('removed'));
  app.post('/admin/games/:id/restore', setStatus('unpublished'));
}
