import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, type Prisma } from '../db.ts';
import { invalid, notFound } from '../errors.ts';
import { requireUser } from '../http/auth.ts';
import { decodeCursor, encodeCursor, pageQuery, slicePage } from '../http/pagination.ts';
import {
  gameSummaryInclude,
  mediaUrlMap,
  toGameSummaries,
  toReviews,
  toUserProfile,
  userLiteSelect,
} from '../http/serializers.ts';
import { isUuid, optionalText, parse, text } from '../http/validate.ts';

const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((s) => {
    try {
      return ['http:', 'https:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

const patchBody = z.object({
  displayName: text(1, 40).optional(),
  bio: optionalText(500).optional(),
  links: z.array(z.object({ label: text(1, 30), url: httpUrl })).max(5).optional(),
  avatarMediaId: z.string().nullable().optional(),
});

const gamesQuery = pageQuery().extend({
  status: z.enum(['published', 'draft', 'unpublished', 'all']).default('published'),
});

type KeysetCursor = { t: string; id: string };

const findUser = async (username: string) => {
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  if (!user) throw notFound('User');
  return user;
};

const excerpt = (s: string) => (s.length > 140 ? `${s.slice(0, 137)}...` : s);

export default async function usersRoutes(app: FastifyInstance) {
  app.get('/users/:username', async (req) => {
    const { username } = req.params as { username: string };
    return { user: await toUserProfile(await findUser(username)) };
  });

  app.patch('/users/me', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const auth = requireUser(req);
    const body = parse(patchBody, req.body);

    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.bio !== undefined) data.bio = body.bio;
    if (body.links !== undefined) data.links = body.links;
    if (body.avatarMediaId !== undefined) {
      if (body.avatarMediaId === null) {
        data.avatarMediaId = null;
      } else {
        if (!isUuid(body.avatarMediaId)) throw invalid('avatarMediaId: must be a UUID');
        const media = await prisma.media.findFirst({
          where: { id: body.avatarMediaId, ownerId: auth.id, kind: 'avatar', status: 'ready' },
          select: { id: true },
        });
        if (!media) throw invalid('avatarMediaId: must be one of your ready avatar uploads', undefined, 'INVALID_MEDIA');
        data.avatarMediaId = media.id;
      }
    }

    const user = await prisma.user.update({ where: { id: auth.id }, data });
    return { user: await toUserProfile(user) };
  });

  app.get('/users/:username/games', async (req) => {
    const { username } = req.params as { username: string };
    const q = parse(gamesQuery, req.query);
    const owner = await findUser(username);
    const isSelf = !!req.user && (req.user.id === owner.id || req.user.role === 'admin');

    // Non-published views are private to the owner.
    const status = isSelf ? q.status : 'published';
    const statusFilter: Prisma.GameWhereInput = status === 'all' ? {} : { status };
    const field: 'publishedAt' | 'createdAt' = status === 'published' ? 'publishedAt' : 'createdAt';

    const cursor = decodeCursor<KeysetCursor>(q.cursor);
    let after: Prisma.GameWhereInput = {};
    if (cursor) {
      const t = new Date(cursor.t);
      after =
        field === 'publishedAt'
          ? { OR: [{ publishedAt: { lt: t } }, { publishedAt: t, id: { lt: cursor.id } }] }
          : { OR: [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: cursor.id } }] };
    }
    const orderBy: Prisma.GameOrderByWithRelationInput[] =
      field === 'publishedAt' ? [{ publishedAt: 'desc' }, { id: 'desc' }] : [{ createdAt: 'desc' }, { id: 'desc' }];

    const rows = await prisma.game.findMany({
      where: { ownerId: owner.id, ...statusFilter, ...after },
      include: gameSummaryInclude,
      orderBy,
      take: q.limit + 1,
    });
    const { items, hasMore } = slicePage(rows, q.limit);
    const last = items.at(-1);
    return {
      items: await toGameSummaries(items, req.user?.id),
      nextCursor: hasMore && last ? encodeCursor({ t: (last[field] ?? last.createdAt).toISOString(), id: last.id }) : null,
    };
  });

  app.get('/users/:username/reviews', async (req) => {
    const { username } = req.params as { username: string };
    const q = parse(pageQuery(), req.query);
    const user = await findUser(username);

    const cursor = decodeCursor<KeysetCursor>(q.cursor);
    const after = cursor
      ? { OR: [{ createdAt: { lt: new Date(cursor.t) } }, { createdAt: new Date(cursor.t), id: { lt: cursor.id } }] }
      : {};

    const rows = await prisma.review.findMany({
      where: { userId: user.id, game: { status: 'published' }, ...after },
      include: {
        user: { select: userLiteSelect },
        game: { select: { id: true, slug: true, title: true, coverMediaId: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { items, hasMore } = slicePage(rows, q.limit);
    const [reviews, covers] = await Promise.all([toReviews(items), mediaUrlMap(items.map((r) => r.game.coverMediaId), 'card')]);
    const last = items.at(-1);
    return {
      items: reviews.map((r, i) => {
        const g = items[i]!.game;
        return { ...r, game: { id: g.id, slug: g.slug, title: g.title, coverUrl: (g.coverMediaId && covers.get(g.coverMediaId)) || null } };
      }),
      nextCursor: hasMore && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null,
    };
  });

  app.get('/users/:username/activity', async (req) => {
    const { username } = req.params as { username: string };
    const user = await findUser(username);
    const gameSel = { select: { id: true, slug: true, title: true } };
    const visible = { game: { status: 'published' as const } };

    const [comments, reviews, likes, published] = await Promise.all([
      prisma.comment.findMany({
        where: { userId: user.id, deletedAt: null, ...visible },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { kind: true, body: true, createdAt: true, game: gameSel },
      }),
      prisma.review.findMany({
        where: { userId: user.id, ...visible },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { rating: true, body: true, createdAt: true, game: gameSel },
      }),
      prisma.gameLike.findMany({
        where: { userId: user.id, ...visible },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { createdAt: true, game: gameSel },
      }),
      prisma.game.findMany({
        where: { ownerId: user.id, status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 30,
        select: { id: true, slug: true, title: true, publishedAt: true },
      }),
    ]);

    const items = [
      ...comments.map((c) => ({ type: c.kind, createdAt: c.createdAt, excerpt: excerpt(c.body), rating: null, game: c.game })),
      ...reviews.map((r) => ({ type: 'review', createdAt: r.createdAt, excerpt: r.body ? excerpt(r.body) : null, rating: r.rating, game: r.game })),
      ...likes.map((l) => ({ type: 'like', createdAt: l.createdAt, excerpt: null, rating: null, game: l.game })),
      ...published.map((g) => ({
        type: 'published',
        createdAt: g.publishedAt ?? new Date(0),
        excerpt: null,
        rating: null,
        game: { id: g.id, slug: g.slug, title: g.title },
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 30);
    return { items };
  });
}
