import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '../db.ts';
import { decodeCursor, encodeCursor, pageQuery } from '../http/pagination.ts';
import { gameSummaryInclude, toGameSummaries, toUserCards, userSummaryMap } from '../http/serializers.ts';
import { escapeLike } from '../http/text.ts';
import { parse } from '../http/validate.ts';
import { cached } from '../redis.ts';

const q = z.string().trim().min(1).max(80);

const searchQuery = pageQuery().extend({
  q,
  type: z.enum(['games', 'users']).default('games'),
  tags: z.string().max(200).optional(),
});

type Ranked = { id: string };

const parseTags = (raw: string | undefined) =>
  [...new Set((raw ?? '').split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 5);

/** `quest rpg` -> `quest:* & rpg:*` (prefix match on every word; only letters/digits survive, so it is safe). */
function prefixQuery(raw: string): string {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 6)
    .map((t) => `${t}:*`)
    .join(' & ');
}

// Typo tolerance comes from pg_trgm; a slightly lower word-similarity threshold lets one misspelt word in a
// longer title still match. `set_config(..., true)` is transaction-local, hence the batched transaction.
const tuneTrigram = () => prisma.$executeRaw`SELECT set_config('pg_trgm.word_similarity_threshold', '0.4', true)`;

async function searchGameIds(raw: string, tags: string[], limit: number, offset: number): Promise<Ranked[]> {
  const tsq = prefixQuery(raw);
  const tagFilter = tags.length ? Prisma.sql`AND g.tags @> ${tags}::text[]` : Prisma.empty;
  const [, rows] = await prisma.$transaction([
    tuneTrigram(),
    prisma.$queryRaw<Ranked[]>`
      SELECT g.id
      FROM games g
      WHERE g.status = 'published'
        AND (g.search_vector @@ to_tsquery('simple', ${tsq}) OR g.title % ${raw} OR ${raw} <% g.title)
        ${tagFilter}
      ORDER BY (COALESCE(ts_rank(g.search_vector, to_tsquery('simple', ${tsq})), 0) * 2
                + GREATEST(similarity(g.title, ${raw}), word_similarity(${raw}, g.title))) DESC,
               g.likes_count DESC, g.published_at DESC, g.id
      LIMIT ${limit} OFFSET ${offset}`,
  ]);
  return rows;
}

async function searchUserIds(raw: string, limit: number, offset: number): Promise<Ranked[]> {
  const contains = `%${escapeLike(raw)}%`;
  const prefix = `${escapeLike(raw)}%`;
  const [, rows] = await prisma.$transaction([
    tuneTrigram(),
    prisma.$queryRaw<Ranked[]>`
      SELECT u.id
      FROM users u
      WHERE u.username % ${raw} OR u.display_name % ${raw} OR u.username ILIKE ${contains} OR u.display_name ILIKE ${contains}
      ORDER BY (GREATEST(similarity(u.username, ${raw}), similarity(u.display_name, ${raw}))
                + CASE WHEN u.username ILIKE ${prefix} THEN 0.5 ELSE 0 END) DESC,
               u.karma_total DESC, u.id
      LIMIT ${limit} OFFSET ${offset}`,
  ]);
  return rows;
}

const gamesByIds = async (ranked: Ranked[], viewerId: string | undefined) => {
  const rows = await prisma.game.findMany({ where: { id: { in: ranked.map((r) => r.id) }, status: 'published' }, include: gameSummaryInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toGameSummaries(ranked.map((r) => byId.get(r.id)).filter((r): r is NonNullable<typeof r> => !!r), viewerId);
};

const usersByIds = async (ranked: Ranked[]) => {
  const rows = await prisma.user.findMany({ where: { id: { in: ranked.map((r) => r.id) } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toUserCards(ranked.map((r) => byId.get(r.id)).filter((r): r is NonNullable<typeof r> => !!r));
};

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (req) => {
    const query = parse(searchQuery, req.query);
    const offset = Math.max(0, Number(decodeCursor<{ o: number }>(query.cursor)?.o ?? 0) || 0);

    // Fetch one extra row to know whether another page exists.
    const ranked =
      query.type === 'games'
        ? await searchGameIds(query.q, parseTags(query.tags), query.limit + 1, offset)
        : await searchUserIds(query.q, query.limit + 1, offset);
    const hasMore = ranked.length > query.limit;
    const page = ranked.slice(0, query.limit);

    return {
      items: query.type === 'games' ? await gamesByIds(page, req.user?.id) : await usersByIds(page),
      nextCursor: hasMore ? encodeCursor({ o: offset + query.limit }) : null,
    };
  });

  app.get('/search/suggest', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { q: raw } = parse(z.object({ q }), req.query);
    const [gameIds, userIds] = await Promise.all([searchGameIds(raw, [], 5, 0), searchUserIds(raw, 5, 0)]);
    const [games, userRows] = await Promise.all([
      gamesByIds(gameIds, undefined),
      prisma.user.findMany({ where: { id: { in: userIds.map((u) => u.id) } }, select: { id: true, username: true, displayName: true, avatarMediaId: true } }),
    ]);
    const summaries = await userSummaryMap(userRows);
    return {
      games: games.map((g) => ({ id: g.id, slug: g.slug, title: g.title, coverUrl: g.coverUrl })),
      users: userIds.map((u) => summaries.get(u.id)).filter((u) => !!u),
    };
  });

  app.get('/tags/popular', async () => ({
    items: await cached('tags:popular:v1', 300, async () => {
      const rows = await prisma.$queryRaw<{ tag: string; count: bigint }[]>`
        SELECT t AS tag, count(*) AS count
        FROM games g, unnest(g.tags) AS t
        WHERE g.status = 'published'
        GROUP BY t
        ORDER BY count DESC, t
        LIMIT 30`;
      return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
    }),
  }));
}
