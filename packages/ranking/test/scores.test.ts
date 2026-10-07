import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  bayesRating,
  computeGameScores,
  engagement,
  freshScore,
  globalAverageRating,
  lovedScore,
  risingScore,
  type GameMetrics,
} from '../src';

describe('engagement', () => {
  it('weighs likes 3, reviews 4, comments 2, downloads 1', () => {
    expect(engagement({ likes: 1, reviews: 1, comments: 1, downloads: 1 })).toBe(10);
    expect(engagement({ likes: 2, reviews: 0, comments: 3, downloads: 10 })).toBe(22);
    expect(engagement({ likes: 0, reviews: 0, comments: 0, downloads: 0 })).toBe(0);
  });

  it('uses the configured weights', () => {
    const cfg = { ...DEFAULT_CONFIG, weights: { like: 1, review: 1, comment: 1, download: 0 } };
    expect(engagement({ likes: 2, reviews: 2, comments: 2, downloads: 99 }, cfg)).toBe(6);
  });
});

describe('freshScore', () => {
  const base = { hasVideo: false, screenshotCount: 0 };
  it('is 1/(1+age) within 14 days', () => {
    expect(freshScore({ ...base, ageDays: 0 })).toBe(1);
    expect(freshScore({ ...base, ageDays: 1 })).toBe(0.5);
    expect(freshScore({ ...base, ageDays: 3 })).toBe(0.25);
    expect(freshScore({ ...base, ageDays: 14 })).toBeCloseTo(1 / 15);
  });
  it('is 0 after 14 days and for future dates', () => {
    expect(freshScore({ ...base, ageDays: 14.01 })).toBe(0);
    expect(freshScore({ ...base, ageDays: -1 })).toBe(0);
  });
  it('boosts complete listings (video and at least 3 screenshots) by 1.2', () => {
    expect(freshScore({ ageDays: 1, hasVideo: true, screenshotCount: 3 })).toBeCloseTo(0.6);
    expect(freshScore({ ageDays: 1, hasVideo: true, screenshotCount: 2 })).toBe(0.5);
    expect(freshScore({ ageDays: 1, hasVideo: false, screenshotCount: 9 })).toBe(0.5);
  });
});

describe('bayesRating / lovedScore', () => {
  it('pulls few reviews towards the global average', () => {
    expect(bayesRating({ globalAvg: 3.5, ratingSum: 0, ratingCount: 0 })).toBe(3.5);
    // one 5-star review: (5*3.5 + 5) / 6
    expect(bayesRating({ globalAvg: 3.5, ratingSum: 5, ratingCount: 1 })).toBeCloseTo(3.75);
    // 100 five-star reviews barely care about the prior
    expect(bayesRating({ globalAvg: 3.5, ratingSum: 500, ratingCount: 100 })).toBeCloseTo(4.93, 2);
  });

  it('adds log10 of total likes, log10 of recent likes and rating/5', () => {
    expect(lovedScore({ likesTotal: 0, likes30d: 0, bayesRating: 0 })).toBe(0);
    expect(lovedScore({ likesTotal: 99, likes30d: 9, bayesRating: 4 })).toBeCloseTo(2 + 1 + 0.8);
  });

  it('ranks a well-rated, well-liked game above a poorly rated one', () => {
    const good = lovedScore({ likesTotal: 100, likes30d: 20, bayesRating: 4.5 });
    const bad = lovedScore({ likesTotal: 100, likes30d: 20, bayesRating: 2.5 });
    expect(good).toBeGreaterThan(bad);
  });
});

describe('risingScore', () => {
  it('needs E_24h >= 5', () => {
    expect(risingScore({ e24h: 4, prev7dDailyAvg: 0, ageDays: 1 })).toBe(0);
    expect(risingScore({ e24h: 5, prev7dDailyAvg: 0, ageDays: 1 })).toBeGreaterThan(0);
  });
  it('only applies to games up to 90 days old', () => {
    expect(risingScore({ e24h: 50, prev7dDailyAvg: 1, ageDays: 90 })).toBeGreaterThan(0);
    expect(risingScore({ e24h: 50, prev7dDailyAvg: 1, ageDays: 91 })).toBe(0);
  });
  it('matches the formula', () => {
    // (20+1)/(4+2) * log2(22)
    expect(risingScore({ e24h: 20, prev7dDailyAvg: 4, ageDays: 5 })).toBeCloseTo(
      (21 / 6) * Math.log2(22),
    );
  });
  it('rewards a jump over the usual baseline', () => {
    const spike = risingScore({ e24h: 30, prev7dDailyAvg: 2, ageDays: 20 });
    const steady = risingScore({ e24h: 30, prev7dDailyAvg: 30, ageDays: 20 });
    expect(spike).toBeGreaterThan(steady * 5);
  });
  it('lets a big absolute jump beat a tiny relative one', () => {
    const big = risingScore({ e24h: 100, prev7dDailyAvg: 10, ageDays: 20 });
    const tiny = risingScore({ e24h: 5, prev7dDailyAvg: 0, ageDays: 20 });
    expect(big).toBeGreaterThan(tiny);
  });
});

const zero = { likes: 0, reviews: 0, comments: 0, downloads: 0 };
const metrics = (over: Partial<GameMetrics>): GameMetrics => ({
  gameId: 'g',
  ageDays: 2,
  hasVideo: false,
  screenshotCount: 1,
  likesTotal: 0,
  likes30d: 0,
  ratingSum: 0,
  ratingCount: 0,
  last24h: zero,
  prev7d: zero,
  last7d: zero,
  ...over,
});

describe('computeGameScores', () => {
  it('uses the platform-wide average rating as the prior', () => {
    const games = [
      metrics({ gameId: 'a', ratingSum: 20, ratingCount: 5 }),
      metrics({ gameId: 'b', ratingSum: 10, ratingCount: 5 }),
    ];
    expect(globalAverageRating(games)).toBe(3);
    expect(globalAverageRating([])).toBe(3.5);
  });

  it('computes all scores for each game', () => {
    const [row] = computeGameScores([
      metrics({
        gameId: 'x',
        ageDays: 1,
        likesTotal: 9,
        likes30d: 9,
        ratingSum: 20,
        ratingCount: 5,
        last24h: { likes: 5, reviews: 1, comments: 0, downloads: 3 },
        prev7d: { likes: 7, reviews: 0, comments: 0, downloads: 0 },
        last7d: { likes: 12, reviews: 1, comments: 0, downloads: 3 },
      }),
    ]);
    expect(row).toMatchObject({
      gameId: 'x',
      freshScore: 0.5,
      engagement24h: 22,
      engagement7d: 43,
    });
    // E24 = 22, prev daily avg = 21/7 = 3
    expect(row!.risingScore).toBeCloseTo((23 / 5) * Math.log2(24));
    // bayes: global avg 4 (20/5): (5*4+20)/10 = 4
    expect(row!.lovedScore).toBeCloseTo(1 + 1 + 0.8);
  });

  it('gives a game with no activity zero rising and a loved score from the prior only', () => {
    const [row] = computeGameScores([metrics({ ageDays: 30 })]);
    expect(row!.risingScore).toBe(0);
    expect(row!.freshScore).toBe(0);
    expect(row!.lovedScore).toBeCloseTo(3.5 / 5);
  });
});
