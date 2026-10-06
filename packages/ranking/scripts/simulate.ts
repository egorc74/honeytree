/**
 * Generates fake engagement over time, runs the real ranking functions and prints the
 * resulting Buzzing / Fresh / Sweetest lists and the mixed feed, so the constants in
 * src/config.ts can be tuned by eye.
 *
 *   pnpm --filter @honeytree/ranking simulate [--games 60] [--days 45] [--seed 7]
 */
import {
  DEFAULT_CONFIG,
  buildFeed,
  computeGameScores,
  type EngagementCounts,
  type FeedCandidate,
  type GameMetrics,
} from '../src';

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const GAMES = arg('games', 60);
const DAYS = arg('days', 45);
const SEED = arg('seed', 7);

// Small deterministic PRNG so runs are repeatable.
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const poisson = (lambda: number) => {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > limit && k < 200);
  return k - 1;
};
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

type EventType = keyof EngagementCounts;
interface SimGame {
  id: string;
  title: string;
  /** Hour (since t=0) when the game was published. */
  launch: number;
  quality: number;
  hasVideo: boolean;
  screenshots: number;
  /** Optional viral window [startHour, endHour) with a rate multiplier. */
  burst?: { from: number; to: number; factor: number };
  events: { hour: number; type: EventType }[];
  ratings: number[];
}

const TOTAL_HOURS = DAYS * 24;
const games: SimGame[] = Array.from({ length: GAMES }, (_, i) => {
  const launch = Math.floor(rand() * (TOTAL_HOURS - 6));
  const g: SimGame = {
    id: `g${String(i + 1).padStart(2, '0')}`,
    title: `Game ${i + 1}`,
    launch,
    quality: Math.exp(normal() * 0.8), // lognormal: a few hits, many average games
    hasVideo: rand() < 0.6,
    screenshots: 1 + Math.floor(rand() * 6),
    events: [],
    ratings: [],
  };
  if (rand() < 0.12) {
    const from = launch + Math.floor(rand() * 24 * 10);
    g.burst = { from, to: from + 24 + Math.floor(rand() * 48), factor: 6 + rand() * 10 };
  }
  return g;
});

// Hourly engagement: a base rate that decays with age, plus an optional viral burst.
const MIX: [EventType, number][] = [
  ['likes', 0.5],
  ['downloads', 0.3],
  ['comments', 0.14],
  ['reviews', 0.06],
];
for (let hour = 0; hour < TOTAL_HOURS; hour++) {
  for (const g of games) {
    if (hour < g.launch) continue;
    const ageDays = (hour - g.launch) / 24;
    let rate = 0.25 * g.quality * (0.35 + 0.65 * Math.exp(-ageDays / 12));
    if (g.burst && hour >= g.burst.from && hour < g.burst.to) rate *= g.burst.factor;
    for (let n = poisson(rate); n > 0; n--) {
      let r = rand();
      const type = MIX.find(([, w]) => (r -= w) < 0)?.[0] ?? 'likes';
      g.events.push({ hour, type });
      if (type === 'reviews')
        g.ratings.push(
          Math.max(1, Math.min(5, Math.round(3.4 + g.quality * 0.5 + normal() * 0.9))),
        );
    }
  }
}

function metricsAt(g: SimGame, now: number): GameMetrics {
  const count = (from: number, to: number): EngagementCounts => {
    const c: EngagementCounts = { likes: 0, reviews: 0, comments: 0, downloads: 0 };
    for (const e of g.events) if (e.hour >= from && e.hour < to) c[e.type]++;
    return c;
  };
  const upToNow = g.events.filter((e) => e.hour < now);
  const ratings = g.ratings.slice(0, upToNow.filter((e) => e.type === 'reviews').length);
  return {
    gameId: g.id,
    ageDays: (now - g.launch) / 24,
    hasVideo: g.hasVideo,
    screenshotCount: g.screenshots,
    likesTotal: upToNow.filter((e) => e.type === 'likes').length,
    likes30d: g.events.filter((e) => e.type === 'likes' && e.hour < now && e.hour >= now - 720)
      .length,
    ratingSum: ratings.reduce((a, b) => a + b, 0),
    ratingCount: ratings.length,
    last24h: count(now - 24, now),
    prev7d: count(now - 8 * 24, now - 24),
    last7d: count(now - 7 * 24, now),
  };
}

function listsAt(now: number) {
  const live = games.filter((g) => g.launch < now);
  const scores = computeGameScores(live.map((g) => metricsAt(g, now)));
  const byId = new Map(live.map((g) => [g.id, g]));
  const list = (pick: (s: (typeof scores)[number]) => number): FeedCandidate[] =>
    scores
      .map((s) => ({
        gameId: s.gameId,
        score: pick(s),
        ageHours: now - byId.get(s.gameId)!.launch,
      }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
  return {
    live,
    scores,
    byId,
    buzzing: list((s) => s.risingScore),
    fresh: list((s) => s.freshScore),
    sweetest: list((s) => s.lovedScore),
  };
}

/** How often does a game in the middle of a viral burst show up in the top of Buzzing? */
function viralHitRate() {
  let checks = 0;
  let hits = 0;
  for (let now = 24 * 5; now <= TOTAL_HOURS; now += 6) {
    const { buzzing } = listsAt(now);
    const top = new Set(buzzing.slice(0, 10).map((c) => c.gameId));
    for (const g of games) {
      if (g.burst && now >= g.burst.from + 12 && now < g.burst.to) {
        checks++;
        if (top.has(g.id)) hits++;
      }
    }
  }
  return { checks, hits };
}

function report(now: number) {
  const { live, scores, byId, buzzing, fresh, sweetest } = listsAt(now);

  console.log(`\n=== Day ${(now / 24).toFixed(0)} (${live.length} games live) ===`);
  const show = (name: string, l: FeedCandidate[], extra: (id: string) => string) => {
    console.log(`\n${name} (${l.length} eligible)`);
    for (const c of l.slice(0, 6)) {
      console.log(
        `  ${c.gameId}  score ${c.score.toFixed(2).padStart(6)}  age ${(c.ageHours / 24).toFixed(1).padStart(4)}d  ${extra(c.gameId)}`,
      );
    }
  };
  const row = (id: string) => {
    const s = scores.find((x) => x.gameId === id)!;
    const g = byId.get(id)!;
    return `E24h ${String(s.engagement24h).padStart(3)}  E7d ${String(s.engagement7d).padStart(4)}${g.burst && now >= g.burst.from && now < g.burst.to + 24 ? '  [viral]' : ''}`;
  };
  show('🐝 Buzzing', buzzing, row);
  show('🆕 Fresh Nectar', fresh, row);
  show('🍯 Sweetest', sweetest, row);

  const feed = buildFeed({ buzzing, fresh, sweetest }, 18);
  console.log('\nMixed feed, first 18:');
  console.log(
    '  ' +
      feed
        .map((i) => `${{ buzzing: '🐝', fresh: '🆕', sweetest: '🍯' }[i.badge]}${i.gameId}`)
        .join(' '),
  );
}

console.log(`Honeytree ranking simulation: ${GAMES} games over ${DAYS} days, seed ${SEED}`);
console.log('Config:', JSON.stringify(DEFAULT_CONFIG));
report(Math.floor(TOTAL_HOURS * 0.5));
report(TOTAL_HOURS);

const { checks, hits } = viralHitRate();
console.log(
  `\nViral sanity: a game in the middle of a burst was in the top 10 of Buzzing in ${hits}/${checks} six-hourly checks (${checks ? Math.round((100 * hits) / checks) : 0}%).`,
);
