import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { gameSummaryInclude, toGameSummaries, toUserCards } from '../http/serializers.ts';
import { parse } from '../http/validate.ts';
import { cached } from '../redis.ts';

const CACHE_SECONDS = 300;

const query = z.object({
  type: z.enum(['games', 'creators', 'karma']),
  period: z.enum(['week', 'month', 'all']).default('week'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

type Period = z.infer<typeof query>['period'];
type Ranked = { id: string; score: number };

const DAY = 86_400_000;
const sinceFor = (period: Period) => new Date(period === 'all' ? 0 : Date.now() - (period === 'week' ? 7 : 30) * DAY);

// The queries return ids + scores only; the objects are re-hydrated per request so counters are
// always current and `likedByMe` is never shared between viewers through the cache.

/** Engagement in the period, the same weights as the feed ranking: 3·likes + 4·reviews + 2·comments + downloads. */
async function topGames(since: Date, limit: number): Promise<Ranked[]> {
  const rows = await prisma.$queryRaw<{ id: string; score: number }[]>`
    SELECT g.id,
           (3 * COALESCE(l.c, 0) + 4 * COALESCE(r.c, 0) + 2 * COALESCE(c.c, 0) + COALESCE(d.c, 0))::float8 AS score
    FROM games g
    LEFT JOIN (SELECT game_id, count(*) AS c FROM game_likes WHERE created_at >= ${since} GROUP BY game_id) l ON l.game_id = g.id
    LEFT JOIN (SELECT game_id, count(*) AS c FROM reviews WHERE created_at >= ${since} GROUP BY game_id) r ON r.game_id = g.id
    LEFT JOIN (
      SELECT cm.game_id, count(*) AS c
      FROM comments cm JOIN games og ON og.id = cm.game_id
      WHERE cm.created_at >= ${since} AND cm.deleted_at IS NULL AND cm.user_id <> og.owner_id
      GROUP BY cm.game_id
    ) c ON c.game_id = g.id
    LEFT JOIN (SELECT game_id, count(*) AS c FROM downloads WHERE created_at >= ${since} GROUP BY game_id) d ON d.game_id = g.id
    WHERE g.status = 'published'
      AND (COALESCE(l.c, 0) + COALESCE(r.c, 0) + COALESCE(c.c, 0) + COALESCE(d.c, 0)) > 0
    ORDER BY score DESC, g.likes_count DESC, g.published_at DESC
    LIMIT ${limit}`;
  return rows;
}

/** Creators: likes received (on their games and comments) in the period. All-time uses the cached counter. */
async function topCreators(period: Period, since: Date, limit: number): Promise<Ranked[]> {
  if (period === 'all') {
    return (
      await prisma.user.findMany({
        where: { gamesCount: { gt: 0 }, likesReceivedTotal: { gt: 0 } },
        orderBy: [{ likesReceivedTotal: 'desc' }, { createdAt: 'asc' }],
        take: limit,
        select: { id: true, likesReceivedTotal: true },
      })
    ).map((u) => ({ id: u.id, score: u.likesReceivedTotal }));
  }
  return prisma.$queryRaw<Ranked[]>`
    SELECT u.id, (COALESCE(gl.c, 0) + COALESCE(cl.c, 0))::float8 AS score
    FROM users u
    LEFT JOIN (
      SELECT g.owner_id, count(*) AS c FROM game_likes l JOIN games g ON g.id = l.game_id
      WHERE l.created_at >= ${since} AND g.status = 'published' GROUP BY g.owner_id
    ) gl ON gl.owner_id = u.id
    LEFT JOIN (
      SELECT cm.user_id, count(*) AS c FROM comment_likes l JOIN comments cm ON cm.id = l.comment_id
      WHERE l.created_at >= ${since} AND cm.deleted_at IS NULL GROUP BY cm.user_id
    ) cl ON cl.user_id = u.id
    WHERE u.games_count > 0 AND (COALESCE(gl.c, 0) + COALESCE(cl.c, 0)) > 0
    ORDER BY score DESC, u.created_at ASC
    LIMIT ${limit}`;
}

/** Karma earned in the period (net of reversals). All-time uses the cached counter. */
async function topKarma(period: Period, since: Date, limit: number): Promise<Ranked[]> {
  if (period === 'all') {
    return (
      await prisma.user.findMany({
        where: { karmaTotal: { gt: 0 } },
        orderBy: [{ karmaTotal: 'desc' }, { createdAt: 'asc' }],
        take: limit,
        select: { id: true, karmaTotal: true },
      })
    ).map((u) => ({ id: u.id, score: u.karmaTotal }));
  }
  const rows = await prisma.$queryRaw<{ id: string; score: bigint }[]>`
    SELECT user_id AS id, SUM(amount) AS score
    FROM karma_events
    WHERE created_at >= ${since}
    GROUP BY user_id
    HAVING SUM(amount) > 0
    ORDER BY score DESC, user_id
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}

export default async function leaderboardRoutes(app: FastifyInstance) {
  app.get('/leaderboard', async (req) => {
    const { type, period, limit } = parse(query, req.query);
    const since = sinceFor(period);

    const ranking = await cached(`lb:v1:${type}:${period}:${limit}`, CACHE_SECONDS, () =>
      type === 'games' ? topGames(since, limit) : type === 'creators' ? topCreators(period, since, limit) : topKarma(period, since, limit),
    );
    const ids = ranking.map((r) => r.id);

    if (type === 'games') {
      const rows = await prisma.game.findMany({ where: { id: { in: ids }, status: 'published' }, include: gameSummaryInclude });
      const byId = new Map((await toGameSummaries(rows, req.user?.id)).map((g) => [g.id, g]));
      const items = ranking.filter((r) => byId.has(r.id));
      return { type, period, items: items.map((r, i) => ({ rank: i + 1, score: r.score, game: byId.get(r.id)! })) };
    }

    const users = await prisma.user.findMany({ where: { id: { in: ids } } });
    const cards = new Map((await toUserCards(users)).map((u) => [u.id, u]));
    const items = ranking.filter((r) => cards.has(r.id));
    return { type, period, items: items.map((r, i) => ({ rank: i + 1, score: r.score, user: cards.get(r.id)! })) };
  });
}
