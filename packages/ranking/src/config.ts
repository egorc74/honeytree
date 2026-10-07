/**
 * Every tunable constant of the feed algorithm (PLAN.md §3.3) lives here. The simulation script
 * (`pnpm --filter @honeytree/ranking simulate`) prints the resulting lists so they can be tuned.
 */
export interface RankingConfig {
  /** E(window) = likes·w.like + reviews·w.review + comments·w.comment + downloads·w.download */
  weights: { like: number; review: number; comment: number; download: number };
  fresh: {
    /** Only games published at most this many days ago get a fresh score. */
    maxAgeDays: number;
    /** Multiplier for games with a video and enough screenshots. */
    completenessBoost: number;
    boostMinScreenshots: number;
  };
  loved: {
    /** Weight of the global average in the Bayesian rating (a prior of this many average reviews). */
    bayesPrior: number;
    /** Rating used when there are no reviews at all on the platform. */
    defaultGlobalAvg: number;
  };
  rising: {
    /** The game needs at least this much engagement in the last 24 hours. */
    minEngagement24h: number;
    maxAgeDays: number;
    /** Smoothing term added to the baseline so a brand-new game does not divide by ~0. */
    baselineSmoothing: number;
  };
  feed: {
    /** Slot pattern of the mixed feed, repeated. */
    pattern: readonly FeedBadge[];
    /** Games younger than this appear only through the Fresh slots (cold-start guarantee). */
    coldStartHours: number;
  };
}

export type FeedBadge = 'buzzing' | 'fresh' | 'sweetest';

export const DEFAULT_CONFIG: RankingConfig = {
  weights: { like: 3, review: 4, comment: 2, download: 1 },
  fresh: { maxAgeDays: 14, completenessBoost: 1.2, boostMinScreenshots: 3 },
  loved: { bayesPrior: 5, defaultGlobalAvg: 3.5 },
  rising: { minEngagement24h: 5, maxAgeDays: 90, baselineSmoothing: 2 },
  feed: {
    pattern: ['buzzing', 'fresh', 'sweetest', 'fresh', 'buzzing', 'sweetest'],
    coldStartHours: 48,
  },
};
