import { DEFAULT_CONFIG, type RankingConfig } from './config';

export interface EngagementCounts {
  /** Unique users who did each thing in the window, the game's owner excluded. */
  likes: number;
  reviews: number;
  comments: number;
  downloads: number;
}

/** E(window) = 3·likes + 4·reviews + 2·comments + 1·downloads (weights from the config). */
export function engagement(counts: EngagementCounts, cfg: RankingConfig = DEFAULT_CONFIG): number {
  const w = cfg.weights;
  return (
    w.like * counts.likes +
    w.review * counts.reviews +
    w.comment * counts.comments +
    w.download * counts.downloads
  );
}

/**
 * Newness score: `1 / (1 + age_days)` for games published within `fresh.maxAgeDays`, else 0.
 * Games with a video and at least 3 screenshots get a ×1.2 completeness boost.
 */
export function freshScore(
  game: { ageDays: number; hasVideo: boolean; screenshotCount: number },
  cfg: RankingConfig = DEFAULT_CONFIG,
): number {
  const { maxAgeDays, completenessBoost, boostMinScreenshots } = cfg.fresh;
  if (game.ageDays < 0 || game.ageDays > maxAgeDays) return 0;
  const complete = game.hasVideo && game.screenshotCount >= boostMinScreenshots;
  return (1 / (1 + game.ageDays)) * (complete ? completenessBoost : 1);
}

/** `(prior·globalAvg + Σratings) / (prior + n)`: few reviews pull a game towards the average. */
export function bayesRating(
  input: { globalAvg: number; ratingSum: number; ratingCount: number },
  cfg: RankingConfig = DEFAULT_CONFIG,
): number {
  const prior = cfg.loved.bayesPrior;
  return (prior * input.globalAvg + input.ratingSum) / (prior + input.ratingCount);
}

/** `log10(1 + likes_total) + log10(1 + likes_30d) + bayes_rating / 5` */
export function lovedScore(input: {
  likesTotal: number;
  likes30d: number;
  bayesRating: number;
}): number {
  return Math.log10(1 + input.likesTotal) + Math.log10(1 + input.likes30d) + input.bayesRating / 5;
}

/**
 * Momentum: `(E_24h + 1) / (E_prev7d_daily_avg + 2) · log2(2 + E_24h)`.
 * The ratio rewards a jump over the game's own recent baseline, and the log term keeps a
 * tiny game with a 10x jump from beating a game with real traffic. Returns 0 unless the game
 * has at least `rising.minEngagement24h` in the last day and is at most `rising.maxAgeDays` old.
 */
export function risingScore(
  input: { e24h: number; prev7dDailyAvg: number; ageDays: number },
  cfg: RankingConfig = DEFAULT_CONFIG,
): number {
  const { minEngagement24h, maxAgeDays, baselineSmoothing } = cfg.rising;
  if (input.e24h < minEngagement24h || input.ageDays > maxAgeDays || input.ageDays < 0) return 0;
  return (
    ((input.e24h + 1) / (input.prev7dDailyAvg + baselineSmoothing)) * Math.log2(2 + input.e24h)
  );
}

/** Raw per-game numbers the worker gathers from the database. */
export interface GameMetrics {
  gameId: string;
  /** Days since publication. */
  ageDays: number;
  hasVideo: boolean;
  screenshotCount: number;
  likesTotal: number;
  likes30d: number;
  /** Σ and count of review ratings (the game's owner excluded). */
  ratingSum: number;
  ratingCount: number;
  /** Engagement counts (owner excluded, unique users) for each window. */
  last24h: EngagementCounts;
  /** The 7 days before the last 24 hours: baseline for `rising`. */
  prev7d: EngagementCounts;
  /** The last 7 days including today. */
  last7d: EngagementCounts;
}

export interface GameScoreRow {
  gameId: string;
  freshScore: number;
  lovedScore: number;
  risingScore: number;
  engagement24h: number;
  engagement7d: number;
}

/** Mean rating over all reviews on the platform, or the configured default when there are none. */
export function globalAverageRating(
  games: Pick<GameMetrics, 'ratingSum' | 'ratingCount'>[],
  cfg: RankingConfig = DEFAULT_CONFIG,
): number {
  let sum = 0;
  let count = 0;
  for (const g of games) {
    sum += g.ratingSum;
    count += g.ratingCount;
  }
  return count === 0 ? cfg.loved.defaultGlobalAvg : sum / count;
}

/** Computes the three scores (and the cached engagement numbers) for every game. */
export function computeGameScores(
  games: GameMetrics[],
  cfg: RankingConfig = DEFAULT_CONFIG,
): GameScoreRow[] {
  const globalAvg = globalAverageRating(games, cfg);
  return games.map((g) => {
    const e24h = engagement(g.last24h, cfg);
    return {
      gameId: g.gameId,
      freshScore: freshScore(g, cfg),
      lovedScore: lovedScore({
        likesTotal: g.likesTotal,
        likes30d: g.likes30d,
        bayesRating: bayesRating(
          { globalAvg, ratingSum: g.ratingSum, ratingCount: g.ratingCount },
          cfg,
        ),
      }),
      risingScore: risingScore(
        { e24h, prev7dDailyAvg: engagement(g.prev7d, cfg) / 7, ageDays: g.ageDays },
        cfg,
      ),
      engagement24h: e24h,
      engagement7d: engagement(g.last7d, cfg),
    };
  });
}
