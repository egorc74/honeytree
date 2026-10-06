/**
 * Demo data: 20 users, 40 games (placeholder media), reviews, comments, suggestions and likes.
 *
 *   pnpm db:seed            seeds an empty database (refuses to touch existing data)
 *   pnpm db:seed --force    wipes everything first
 *
 * Every user's password is `honeytree123`. `hivemaster` is an admin.
 * Deterministic: the same seed always produces the same data (relative to "now").
 */
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

// ------------------------------------------------------------------ deterministic randomness
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261006);
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const chance = (p: number) => rand() < p;
const shuffle = <T>(arr: readonly T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
const sample = <T>(arr: readonly T[], n: number): T[] => shuffle(arr).slice(0, n);

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms);

// ------------------------------------------------------------------ content pools
const USERNAMES = [
  'hivemaster', 'queenbee', 'drone_dev', 'waggle_dance', 'nectar_nick', 'comb_coder', 'pollen_pixel', 'bumble_bytes',
  'honeydew', 'stinger_studio', 'apiary_arts', 'buzzkill', 'wax_wizard', 'royal_jelly', 'sweet_sprite', 'amber_ash',
  'clover_kid', 'lavender_lou', 'busy_bea', 'dandelion_dan',
];
const ADJECTIVES = ['Golden', 'Sticky', 'Buzzing', 'Sweet', 'Hidden', 'Cosmic', 'Tiny', 'Wild', 'Amber', 'Royal', 'Lazy', 'Neon', 'Cozy', 'Frantic', 'Silent'];
const NOUNS = ['Hive', 'Meadow', 'Heist', 'Quest', 'Racer', 'Garden', 'Tycoon', 'Dungeon', 'Jam', 'Colony', 'Drift', 'Kingdom', 'Orchard', 'Puzzle', 'Siege'];
const TAGS = ['rpg', 'puzzle', 'platformer', 'cozy', 'roguelike', 'racing', 'strategy', 'horror', 'pixel-art', 'multiplayer', 'adventure', 'sandbox', 'shooter', 'retro', 'jam-game'];
const PLATFORMS = ['windows', 'mac', 'linux', 'web', 'android'] as const;
const BLURBS = [
  'A bite-sized adventure made over one frantic weekend.',
  'Build, defend and sweeten your corner of the meadow.',
  'Fast, fluffy and a little bit sticky.',
  'A cozy puzzler about sharing the harvest.',
  'Dodge, dash and collect every last drop.',
];
const REVIEWS = [
  'Absolutely lovely, I lost a whole evening to this and regret nothing.',
  'Great idea and very polished for a jam game. The controls feel tight.',
  'Fun for the first hour, then it gets repetitive. Still worth a download.',
  'The art style is gorgeous and the music stuck in my head all week.',
  'Needs more levels, but what is here is really well designed.',
  'A little buggy on my machine but I could not stop playing.',
  'Short, sweet and surprisingly deep. Would happily pay for a full version.',
  '',
];
const COMMENTS = [
  'Just finished it, loved the ending!',
  'How did you make the water shader? It looks amazing.',
  'Is there a Mac build planned?',
  'Played this with my kids and they adored it.',
  'The second boss took me ages, no spoilers please :)',
  'Following for the next update!',
];
const SUGGESTIONS = [
  'Please add controller support, the keyboard layout is hard on my wrists.',
  'A colour-blind mode would make the puzzles accessible to more people.',
  'It would be great to be able to rebind keys.',
  'Maybe add a speedrun timer? The movement is begging for it.',
  'Could you add a difficulty slider for the late levels?',
];
const REPLIES = ['Thanks for playing!', 'Good point, noted.', 'Agreed, that would be great.', 'Haha, glad you liked it.'];

type Row = Record<string, unknown>;

async function main() {
  const force = process.argv.includes('--force');
  if ((await prisma.user.count()) > 0) {
    if (!force) {
      console.log('Database is not empty: nothing seeded. Use `--force` to wipe it and seed again.');
      return;
    }
    await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
  }

  const passwordHash = await argon2.hash('honeytree123');

  // ---------------------------------------------------------------- users
  const users = USERNAMES.map((username, i) => ({
    id: randomUUID(),
    username,
    email: `${username}@honeytree.test`,
    passwordHash,
    displayName: username.split('_').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' '),
    avatarMediaId: randomUUID(),
    bio: i % 3 === 0 ? 'Making small games with big hearts. 🐝' : i % 3 === 1 ? 'Gamer. Tester. Honey enthusiast.' : '',
    links: i % 4 === 0 ? [{ label: 'Website', url: `https://example.com/${username}` }] : [],
    role: i === 0 ? ('admin' as const) : ('user' as const),
    createdAt: ago((60 - i * 2) * DAY),
  }));
  await prisma.user.createMany({ data: users });
  await prisma.media.createMany({
    data: users.map((u, i) => ({
      id: u.avatarMediaId,
      ownerId: u.id,
      kind: 'avatar' as const,
      storageKey: `placeholder:avatar-${i + 1}`,
      originalName: 'avatar.png',
      mime: 'image/png',
      sizeBytes: 20_000,
      status: 'ready' as const,
    })),
  });

  // ---------------------------------------------------------------- games (the first 12 users are creators)
  const creators = users.slice(0, 12);
  type SeedGame = { id: string; ownerId: string; slug: string; status: string; publishedAt: Date | null };
  const games: SeedGame[] = [];
  const gameRows: Row[] = [];
  const media: Row[] = [];
  const usedSlugs = new Set<string>();

  for (let i = 0; i < 40; i++) {
    let title: string;
    let slug: string;
    do {
      title = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
      slug = title.toLowerCase().replace(/\s+/g, '-');
    } while (usedSlugs.has(slug));
    usedSlugs.add(slug);

    const owner = creators[i % creators.length]!;
    const status = i >= 38 ? 'draft' : i >= 36 ? 'unpublished' : 'published';
    // Spread over 60 days; the last few are brand new so the "fresh" slots have content.
    const publishedAt = status === 'draft' ? null : ago(i < 6 ? int(2, 48) * HOUR : int(3, 60) * DAY);
    const id = randomUUID();
    const coverId = randomUUID();
    games.push({ id, ownerId: owner.id, slug, status, publishedAt });
    gameRows.push({
      id,
      ownerId: owner.id,
      slug,
      title,
      shortDescription: pick(BLURBS),
      description: `# ${title}\n\n${pick(BLURBS)}\n\n- Controls: arrow keys / WASD\n- Made in ${int(2, 14)} days\n\n${pick(BLURBS)}`,
      tags: sample(TAGS, int(2, 4)),
      platforms: sample(PLATFORMS, int(1, 3)),
      version: `${int(0, 2)}.${int(0, 9)}.${int(0, 9)}`,
      status,
      coverMediaId: coverId,
      publishedAt,
      createdAt: publishedAt ? new Date(publishedAt.getTime() - DAY) : ago(int(1, 5) * DAY),
    });
    const base = { gameId: id, ownerId: owner.id, mime: 'image/png', sizeBytes: 400_000, status: 'ready' as const };
    media.push({ ...base, id: coverId, kind: 'cover', storageKey: `placeholder:cover-${i + 1}`, originalName: 'cover.png' });
    for (let s = 0; s < 3; s++) {
      media.push({ ...base, id: randomUUID(), kind: 'screenshot', storageKey: `placeholder:shot-${i + 1}-${s + 1}`, originalName: `shot${s + 1}.png`, sortOrder: s });
    }
    media.push({
      ...base,
      id: randomUUID(),
      kind: 'build',
      storageKey: `seed/builds/${slug}.zip`,
      originalName: `${slug}.zip`,
      mime: 'application/zip',
      sizeBytes: int(5, 900) * 1_000_000,
    });
  }
  await prisma.game.createMany({ data: gameRows as never });
  await prisma.media.createMany({ data: media as never });

  // ---------------------------------------------------------------- social activity (published games only)
  const published = games.filter((g) => g.status === 'published');
  const gameLikes: Row[] = [];
  const reviews: Row[] = [];
  const comments: Row[] = [];
  const commentLikes: Row[] = [];
  const downloads: Row[] = [];

  published.forEach((g, idx) => {
    // Popularity: a few hits, many quiet games; recent games get a burst in the last day ("buzzing").
    const popularity = idx % 7 === 0 ? 1 : idx % 3 === 0 ? 0.55 : 0.2;
    const others = users.filter((u) => u.id !== g.ownerId);
    const stamp = () => {
      const t = g.publishedAt!.getTime();
      const recentBurst = chance(0.35) ? NOW - int(1, 20) * HOUR : t + rand() * (NOW - t);
      return new Date(Math.max(t + HOUR, Math.min(NOW - 60_000, recentBurst)));
    };

    for (const u of sample(others, Math.round(others.length * popularity * (0.4 + rand() * 0.6)))) {
      gameLikes.push({ userId: u.id, gameId: g.id, createdAt: stamp() });
    }
    for (const u of sample(others, int(0, Math.round(6 * popularity + 1)))) {
      reviews.push({
        id: randomUUID(),
        gameId: g.id,
        userId: u.id,
        rating: chance(0.7) ? int(4, 5) : int(2, 4),
        body: pick(REVIEWS),
        createdAt: stamp(),
      });
    }
    for (const u of sample(others, int(0, Math.round(8 * popularity + 1)))) {
      downloads.push({ id: randomUUID(), gameId: g.id, userId: u.id, ipHash: randomUUID().slice(0, 16), createdAt: stamp() });
    }

    const tops: { id: string; userId: string; createdAt: Date }[] = [];
    for (const u of sample(others, int(0, Math.round(5 * popularity + 1)))) {
      const kind = chance(0.3) ? 'suggestion' : 'comment';
      const createdAt = stamp();
      const c = { id: randomUUID(), gameId: g.id, userId: u.id, parentId: null, kind, body: kind === 'suggestion' ? pick(SUGGESTIONS) : pick(COMMENTS), createdAt };
      tops.push(c);
      comments.push({ ...c, acceptedAt: kind === 'suggestion' && chance(0.4) ? new Date(createdAt.getTime() + HOUR) : null });
    }
    // Owner replies to some top-level comments.
    for (const t of tops.filter(() => chance(0.5))) {
      comments.push({
        id: randomUUID(),
        gameId: g.id,
        userId: g.ownerId,
        parentId: t.id,
        kind: 'comment',
        body: pick(REPLIES),
        createdAt: new Date(t.createdAt.getTime() + 2 * HOUR),
      });
    }
    // Comment likes (never by the author).
    for (const c of tops) {
      for (const u of sample(users.filter((x) => x.id !== c.userId), int(0, 4))) {
        commentLikes.push({ userId: u.id, commentId: c.id, createdAt: new Date(c.createdAt.getTime() + int(1, 30) * HOUR) });
      }
    }
  });

  await prisma.gameLike.createMany({ data: gameLikes as never });
  await prisma.review.createMany({ data: reviews as never });
  await prisma.comment.createMany({ data: comments as never });
  await prisma.commentLike.createMany({ data: commentLikes as never });
  await prisma.download.createMany({ data: downloads as never });

  // ---------------------------------------------------------------- derived data: counters, karma ledger, scores
  // Counters
  await prisma.$executeRawUnsafe(`
    UPDATE games g SET
      likes_count = (SELECT count(*) FROM game_likes l WHERE l.game_id = g.id),
      downloads_count = (SELECT count(*) FROM downloads d WHERE d.game_id = g.id),
      comments_count = (SELECT count(*) FROM comments c WHERE c.game_id = g.id AND c.deleted_at IS NULL),
      reviews_count = (SELECT count(*) FROM reviews r WHERE r.game_id = g.id),
      rating_avg = (SELECT round(avg(r.rating)::numeric, 2)::float8 FROM reviews r WHERE r.game_id = g.id)`);
  await prisma.$executeRawUnsafe(
    `UPDATE comments c SET likes_count = (SELECT count(*) FROM comment_likes l WHERE l.comment_id = c.id)`,
  );

  // Karma ledger: the same rules as the live API (actor earns; no karma on own games/comments; reviews need 20+ chars).
  await prisma.$executeRawUnsafe(`
    INSERT INTO karma_events (id, user_id, amount, reason, ref_type, ref_id, created_at)
    SELECT gen_random_uuid(), l.user_id, 1, 'like_game'::"KarmaReason", 'game', l.game_id, l.created_at FROM game_likes l
    UNION ALL
    SELECT gen_random_uuid(), cl.user_id, 1, 'like_comment'::"KarmaReason", 'comment', cl.comment_id, cl.created_at FROM comment_likes cl
    UNION ALL
    SELECT gen_random_uuid(), c.user_id, CASE WHEN c.kind = 'suggestion' THEN 3 ELSE 2 END,
           CASE WHEN c.kind = 'suggestion' THEN 'suggestion' ELSE 'comment' END::"KarmaReason", 'comment', c.id, c.created_at
      FROM comments c JOIN games g ON g.id = c.game_id
      LEFT JOIN comments p ON p.id = c.parent_id
      WHERE c.user_id <> g.owner_id AND (p.user_id IS NULL OR p.user_id <> c.user_id)
    UNION ALL
    SELECT gen_random_uuid(), r.user_id, 3, 'review'::"KarmaReason", 'review', r.id, r.created_at FROM reviews r WHERE length(trim(r.body)) >= 20
    UNION ALL
    SELECT gen_random_uuid(), c.user_id, 10, 'suggestion_accepted'::"KarmaReason", 'comment', c.id, c.accepted_at FROM comments c WHERE c.accepted_at IS NOT NULL`);

  // User stats
  await prisma.$executeRawUnsafe(`
    UPDATE users u SET
      karma_total = COALESCE((SELECT sum(e.amount) FROM karma_events e WHERE e.user_id = u.id), 0),
      games_count = (SELECT count(*) FROM games g WHERE g.owner_id = u.id AND g.status = 'published'),
      likes_received_total =
        COALESCE((SELECT sum(g.likes_count) FROM games g WHERE g.owner_id = u.id), 0) +
        COALESCE((SELECT sum(c.likes_count) FROM comments c WHERE c.user_id = u.id AND c.deleted_at IS NULL), 0),
      rating_count = (SELECT count(*) FROM reviews r JOIN games g ON g.id = r.game_id WHERE g.owner_id = u.id),
      rating_avg = (SELECT round(avg(r.rating)::numeric, 2)::float8 FROM reviews r JOIN games g ON g.id = r.game_id WHERE g.owner_id = u.id)`);

  // Rough feed scores so the local feed shows all three badges before the worker (Agent 3) exists.
  // The worker overwrites these every 5 minutes with the real formulas.
  await prisma.$executeRawUnsafe(`
    INSERT INTO game_scores (game_id, fresh_score, loved_score, rising_score, engagement_24h, engagement_7d, computed_at)
    SELECT g.id,
      CASE WHEN g.published_at >= now() - interval '14 days'
           THEN 1.0 / (1 + extract(epoch FROM now() - g.published_at) / 86400.0) ELSE 0 END,
      log(1 + g.likes_count) + coalesce(g.rating_avg, 0) / 5.0,
      CASE WHEN e.e24 >= 5 THEN (e.e24 + 1.0) / (e.e7 / 7.0 + 2) * log(2, 2 + e.e24) ELSE 0 END,
      e.e24, e.e7, now()
    FROM games g
    CROSS JOIN LATERAL (
      SELECT
        (SELECT 3 * count(*) FROM game_likes l WHERE l.game_id = g.id AND l.created_at >= now() - interval '1 day') +
        (SELECT 4 * count(*) FROM reviews r WHERE r.game_id = g.id AND r.created_at >= now() - interval '1 day') +
        (SELECT 2 * count(*) FROM comments c WHERE c.game_id = g.id AND c.user_id <> g.owner_id AND c.created_at >= now() - interval '1 day') +
        (SELECT count(*) FROM downloads d WHERE d.game_id = g.id AND d.created_at >= now() - interval '1 day') AS e24,
        (SELECT 3 * count(*) FROM game_likes l WHERE l.game_id = g.id AND l.created_at >= now() - interval '7 days') +
        (SELECT 4 * count(*) FROM reviews r WHERE r.game_id = g.id AND r.created_at >= now() - interval '7 days') +
        (SELECT 2 * count(*) FROM comments c WHERE c.game_id = g.id AND c.user_id <> g.owner_id AND c.created_at >= now() - interval '7 days') +
        (SELECT count(*) FROM downloads d WHERE d.game_id = g.id AND d.created_at >= now() - interval '7 days') AS e7
    ) e
    WHERE g.status = 'published'`);

  const [u, g, l, r, c] = await Promise.all([
    prisma.user.count(),
    prisma.game.count(),
    prisma.gameLike.count(),
    prisma.review.count(),
    prisma.comment.count(),
  ]);
  console.log(`Seeded ${u} users, ${g} games, ${l} likes, ${r} reviews, ${c} comments. Password for everyone: honeytree123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
