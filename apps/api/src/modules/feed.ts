import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { decodeCursor, encodeCursor, pageQuery } from '../http/pagination.ts';
import { gameSummaryInclude, toGameSummaries } from '../http/serializers.ts';
import { parse } from '../http/validate.ts';
import { cached, FEED_SEQUENCE_KEY } from '../redis.ts';
import { FEED_MAX, interleave, type Badge } from '../services/interleave.ts';

const LIST_SIZE = 100;
const FRESH_DAYS = 14;
const SEQUENCE_TTL_SECONDS = 60;

type Slot = { id: string; badge: Badge | null };

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

/**
 * Ranked id lists. They read `game_scores` (written by the worker every 5 minutes) but never depend on it:
 * a game without a score row still gets a sensible fallback, so the feed works before the worker exists
 * and a freshly published game shows up immediately in the Fresh slots.
 */
async function rankedLists() {
  const [buzzing, fresh, sweetest] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM games g
      JOIN game_scores s ON s.game_id = g.id
      WHERE g.status = 'published' AND s.rising_score > 0
      ORDER BY s.rising_score DESC, g.published_at DESC
      LIMIT ${LIST_SIZE}`,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM games g
      LEFT JOIN game_scores s ON s.game_id = g.id
      WHERE g.status = 'published' AND g.published_at >= now() - make_interval(days => ${FRESH_DAYS})
      ORDER BY COALESCE(s.fresh_score, 1.0 / (1 + EXTRACT(EPOCH FROM (now() - g.published_at)) / 86400.0)) DESC,
               g.published_at DESC
      LIMIT ${LIST_SIZE}`,
    prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id FROM games g
      LEFT JOIN game_scores s ON s.game_id = g.id
      WHERE g.status = 'published' AND (g.likes_count > 0 OR s.loved_score > 0)
      ORDER BY COALESCE(NULLIF(s.loved_score, 0), log(1 + g.likes_count)) DESC, g.likes_count DESC, g.published_at DESC
      LIMIT ${LIST_SIZE}`,
  ]);
  return { buzzing: ids(buzzing), fresh: ids(fresh), sweetest: ids(sweetest) };
}

async function buildSequence(): Promise<Slot[]> {
  const mixed: Slot[] = interleave(await rankedLists());
  const seen = new Set(mixed.map((s) => s.id));

  // Tail: everything else, newest first. Recent games keep a "fresh" badge, older ones are plain.
  const tail = await prisma.$queryRaw<{ id: string; fresh: boolean }[]>`
    SELECT id, published_at >= now() - make_interval(days => ${FRESH_DAYS}) AS fresh
    FROM games
    WHERE status = 'published'
    ORDER BY published_at DESC, id DESC
    LIMIT ${FEED_MAX}`;
  for (const t of tail) {
    if (mixed.length >= FEED_MAX) break;
    if (!seen.has(t.id)) mixed.push({ id: t.id, badge: t.fresh ? 'fresh' : null });
  }
  return mixed;
}

async function hydrate(slots: Slot[], viewerId: string | undefined) {
  if (!slots.length) return [];
  const rows = await prisma.game.findMany({
    where: { id: { in: slots.map((s) => s.id) }, status: 'published' },
    include: gameSummaryInclude,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const present = slots.filter((s) => byId.has(s.id)); // a game may have been unpublished since the cache was filled
  const summaries = await toGameSummaries(present.map((s) => byId.get(s.id)!), viewerId);
  return summaries.map((game, i) => ({ badge: present[i]!.badge, game }));
}

export default async function feedRoutes(app: FastifyInstance) {
  app.get('/feed', async (req) => {
    const q = parse(pageQuery(20, 30), req.query);
    const offset = Math.max(0, Number(decodeCursor<{ o: number }>(q.cursor)?.o ?? 0) || 0);

    const sequence = await cached(FEED_SEQUENCE_KEY, SEQUENCE_TTL_SECONDS, buildSequence);
    const next = offset + q.limit;
    return {
      items: await hydrate(sequence.slice(offset, next), req.user?.id),
      nextCursor: next < sequence.length ? encodeCursor({ o: next }) : null,
    };
  });

  app.get('/feed/buzzing', async (req) => {
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(24).default(12) }), req.query);

    const rising = ids(
      await prisma.$queryRaw<{ id: string }[]>`
        SELECT g.id FROM games g
        JOIN game_scores s ON s.game_id = g.id
        WHERE g.status = 'published' AND s.rising_score > 0
        ORDER BY s.rising_score DESC, g.published_at DESC
        LIMIT ${limit}`,
    );
    const slots: Slot[] = rising.map((id) => ({ id, badge: 'buzzing' as const }));

    // Never leave the carousel empty: pad with the most liked recent games (no badge, they are not "rising").
    if (slots.length < limit) {
      const filler = await prisma.game.findMany({
        where: { status: 'published', id: { notIn: rising }, publishedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: [{ likesCount: 'desc' }, { publishedAt: 'desc' }],
        take: limit - slots.length,
        select: { id: true },
      });
      slots.push(...filler.map((g) => ({ id: g.id, badge: null })));
    }
    return { items: await hydrate(slots, req.user?.id) };
  });
}
