import {
  DEFAULT_CONFIG,
  computeGameScores,
  type EngagementCounts,
  type GameMetrics,
} from '@honeytree/ranking';
import type { WorkerContext } from '../context';

/*
 * One query gathers, for every published game, what the ranking functions need. All windows
 * count unique users, never count the game's owner, and are measured back from $1 (now):
 *   d1   the last 24 hours
 *   prev the 7 days before that (now-8d .. now-1d), the baseline for `rising`
 *   w7   the last 7 days
 * Likes and reviews are limited to one row per user by their primary keys; comments count
 * distinct commenters (deleted comments excluded); downloads count distinct users or IP hashes.
 */
const WINDOWS = (col: string, who: string) => `
  count(DISTINCT ${who}) FILTER (WHERE ${col} > $1::timestamptz - interval '24 hours' AND ${col} <= $1::timestamptz) AS d1,
  count(DISTINCT ${who}) FILTER (WHERE ${col} >= $1::timestamptz - interval '8 days' AND ${col} < $1::timestamptz - interval '1 day') AS prev,
  count(DISTINCT ${who}) FILTER (WHERE ${col} > $1::timestamptz - interval '7 days' AND ${col} <= $1::timestamptz) AS w7`;

export const METRICS_SQL = `
WITH g AS (
  SELECT id, owner_id, COALESCE(published_at, created_at) AS published_at
  FROM games WHERE status = 'published'
),
likes AS (
  SELECT x.game_id, ${WINDOWS('x.created_at', 'x.user_id')},
    count(DISTINCT x.user_id) FILTER (WHERE x.created_at > $1::timestamptz - interval '30 days' AND x.created_at <= $1::timestamptz) AS d30,
    count(DISTINCT x.user_id) FILTER (WHERE x.created_at <= $1::timestamptz) AS total
  FROM game_likes x JOIN g ON g.id = x.game_id WHERE x.user_id <> g.owner_id
  GROUP BY x.game_id
),
reviews AS (
  SELECT x.game_id, ${WINDOWS('x.created_at', 'x.user_id')},
    COALESCE(sum(x.rating), 0) AS rating_sum, count(*) AS rating_count
  FROM reviews x JOIN g ON g.id = x.game_id WHERE x.user_id <> g.owner_id
  GROUP BY x.game_id
),
comments AS (
  SELECT x.game_id, ${WINDOWS('x.created_at', 'x.user_id')}
  FROM comments x JOIN g ON g.id = x.game_id
  WHERE x.user_id <> g.owner_id AND x.deleted_at IS NULL
  GROUP BY x.game_id
),
downloads AS (
  SELECT x.game_id, ${WINDOWS('x.created_at', 'COALESCE(x.user_id::text, x.ip_hash)')}
  FROM downloads x JOIN g ON g.id = x.game_id
  WHERE x.user_id IS DISTINCT FROM g.owner_id
  GROUP BY x.game_id
),
media AS (
  SELECT x.game_id,
    bool_or(x.kind = 'video') AS has_video,
    count(*) FILTER (WHERE x.kind = 'screenshot') AS screenshots
  FROM media x JOIN g ON g.id = x.game_id WHERE x.status = 'ready'
  GROUP BY x.game_id
)
SELECT g.id AS "gameId",
  extract(epoch FROM ($1::timestamptz - g.published_at)) / 86400.0 AS "ageDays",
  COALESCE(media.has_video, false) AS "hasVideo",
  COALESCE(media.screenshots, 0)::int AS "screenshotCount",
  COALESCE(likes.total, 0)::int AS "likesTotal", COALESCE(likes.d30, 0)::int AS "likes30d",
  COALESCE(reviews.rating_sum, 0)::float8 AS "ratingSum", COALESCE(reviews.rating_count, 0)::int AS "ratingCount",
  COALESCE(likes.d1, 0)::int AS l1, COALESCE(reviews.d1, 0)::int AS r1,
  COALESCE(comments.d1, 0)::int AS c1, COALESCE(downloads.d1, 0)::int AS dl1,
  COALESCE(likes.prev, 0)::int AS lp, COALESCE(reviews.prev, 0)::int AS rp,
  COALESCE(comments.prev, 0)::int AS cp, COALESCE(downloads.prev, 0)::int AS dlp,
  COALESCE(likes.w7, 0)::int AS l7, COALESCE(reviews.w7, 0)::int AS r7,
  COALESCE(comments.w7, 0)::int AS c7, COALESCE(downloads.w7, 0)::int AS dl7
FROM g
LEFT JOIN likes ON likes.game_id = g.id
LEFT JOIN reviews ON reviews.game_id = g.id
LEFT JOIN comments ON comments.game_id = g.id
LEFT JOIN downloads ON downloads.game_id = g.id
LEFT JOIN media ON media.game_id = g.id
WHERE g.published_at <= $1::timestamptz`;

interface MetricsRow {
  gameId: string;
  ageDays: number | string;
  hasVideo: boolean;
  screenshotCount: number;
  likesTotal: number;
  likes30d: number;
  ratingSum: number;
  ratingCount: number;
  l1: number;
  r1: number;
  c1: number;
  dl1: number;
  lp: number;
  rp: number;
  cp: number;
  dlp: number;
  l7: number;
  r7: number;
  c7: number;
  dl7: number;
}

const counts = (
  likes: number,
  reviews: number,
  comments: number,
  downloads: number,
): EngagementCounts => ({
  likes: Number(likes),
  reviews: Number(reviews),
  comments: Number(comments),
  downloads: Number(downloads),
});

export function toMetrics(r: MetricsRow): GameMetrics {
  return {
    gameId: r.gameId,
    ageDays: Number(r.ageDays),
    hasVideo: r.hasVideo,
    screenshotCount: Number(r.screenshotCount),
    likesTotal: Number(r.likesTotal),
    likes30d: Number(r.likes30d),
    ratingSum: Number(r.ratingSum),
    ratingCount: Number(r.ratingCount),
    last24h: counts(r.l1, r.r1, r.c1, r.dl1),
    prev7d: counts(r.lp, r.rp, r.cp, r.dlp),
    last7d: counts(r.l7, r.r7, r.c7, r.dl7),
  };
}

export interface ScoresResult {
  games: number;
  removed: number;
}

/**
 * Recomputes `game_scores` for every published game and removes the rows of games that are no
 * longer published. Runs every 5 minutes; the feed endpoint only ever reads the table.
 */
export async function computeScores(ctx: WorkerContext): Promise<ScoresResult> {
  const now = ctx.now();
  const { rows } = await ctx.db.query<MetricsRow>(METRICS_SQL, [now]);
  const scores = computeGameScores(rows.map(toMetrics), DEFAULT_CONFIG);

  if (scores.length > 0) {
    await ctx.db.query(
      `INSERT INTO game_scores (game_id, fresh_score, loved_score, rising_score,
                                engagement_24h, engagement_7d, computed_at)
       SELECT t.game_id, t.fresh, t.loved, t.rising, t.e24, t.e7, $7::timestamptz
       FROM unnest($1::uuid[], $2::float8[], $3::float8[], $4::float8[], $5::float8[], $6::float8[])
         AS t(game_id, fresh, loved, rising, e24, e7)
       ON CONFLICT (game_id) DO UPDATE SET
         fresh_score = EXCLUDED.fresh_score, loved_score = EXCLUDED.loved_score,
         rising_score = EXCLUDED.rising_score, engagement_24h = EXCLUDED.engagement_24h,
         engagement_7d = EXCLUDED.engagement_7d, computed_at = EXCLUDED.computed_at`,
      [
        scores.map((s) => s.gameId),
        scores.map((s) => s.freshScore),
        scores.map((s) => s.lovedScore),
        scores.map((s) => s.risingScore),
        scores.map((s) => s.engagement24h),
        scores.map((s) => s.engagement7d),
        now,
      ],
    );
  }
  const removed = await ctx.db.query<{ game_id: string }>(
    `DELETE FROM game_scores WHERE game_id <> ALL($1::uuid[]) RETURNING game_id`,
    [scores.map((s) => s.gameId)],
  );
  ctx.log.info('scores computed', { games: scores.length, removed: removed.rows.length });
  return { games: scores.length, removed: removed.rows.length };
}
