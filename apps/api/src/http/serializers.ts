import { config } from '../config.ts';
import { prisma, type Prisma } from '../db.ts';
import type { AuthUser } from './auth.ts';

// ---------------------------------------------------------------- media URLs

/**
 * Storage keys become public URLs. `placeholder:<name>` keys (seed data) are served by this API;
 * everything else lives in the object-storage bucket at MEDIA_PUBLIC_BASE_URL.
 */
export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith('placeholder:')) return `${config.apiPublicUrl}/placeholders/${key.slice('placeholder:'.length)}.svg`;
  if (/^https?:\/\//.test(key)) return key;
  return `${config.mediaPublicBaseUrl}/${key.replace(/^\/+/, '')}`;
}

type Variants = Partial<Record<'thumb' | 'card' | 'full' | 'poster' | 'mp4', string>>;

/**
 * `media.variants` is written by the media worker (Agent 3): each entry is `{ key, width, height, ... }`, next to a
 * `rejectReason` string. Plain storage-key strings (seed data, older rows) are accepted too.
 */
const asStored = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function variantKey(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  const key = (v as { key?: unknown } | null)?.key;
  return typeof key === 'string' ? key : undefined;
}

/** Storage keys of every stored variant (used to clean up files when a game is deleted). */
export const variantKeys = (v: unknown): string[] =>
  Object.entries(asStored(v))
    .filter(([name]) => name !== 'rejectReason')
    .map(([, value]) => variantKey(value))
    .filter((k): k is string => !!k);

/** Batch lookup: media id → URL of the preferred variant (falls back to the original file). */
export async function mediaUrlMap(ids: (string | null | undefined)[], variant: 'thumb' | 'card') {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!wanted.length) return map;
  const rows = await prisma.media.findMany({
    where: { id: { in: wanted }, status: 'ready' },
    select: { id: true, storageKey: true, variants: true },
  });
  for (const m of rows) {
    const url = mediaUrl(variantKey(asStored(m.variants)[variant]) ?? m.storageKey);
    if (url) map.set(m.id, url);
  }
  return map;
}

// ---------------------------------------------------------------- users

export const userLiteSelect = { id: true, username: true, displayName: true, avatarMediaId: true } as const;
export type UserLite = { id: string; username: string; displayName: string; avatarMediaId: string | null };
export type UserSummary = { id: string; username: string; displayName: string; avatarUrl: string | null };

export async function userSummaryMap(users: UserLite[]): Promise<Map<string, UserSummary>> {
  const avatars = await mediaUrlMap(users.map((u) => u.avatarMediaId), 'thumb');
  return new Map(
    users.map((u) => [
      u.id,
      { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: (u.avatarMediaId && avatars.get(u.avatarMediaId)) || null },
    ]),
  );
}

export async function toUserSummary(u: UserLite): Promise<UserSummary> {
  return (await userSummaryMap([u])).get(u.id)!;
}

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

type UserWithStats = UserLite & {
  likesReceivedTotal: number;
  gamesCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  karmaTotal: number;
};

export const userStats = (u: UserWithStats) => ({
  likesReceived: u.likesReceivedTotal,
  gamesCount: u.gamesCount,
  ratingAvg: round2(u.ratingAvg),
  ratingCount: u.ratingCount,
  karma: u.karmaTotal,
});

export async function toUserCards(users: UserWithStats[]) {
  const map = await userSummaryMap(users);
  return users.map((u) => ({ ...map.get(u.id)!, stats: userStats(u) }));
}

export async function toUserProfile(u: UserWithStats & { bio: string; links: unknown; createdAt: Date }) {
  return {
    ...(await toUserSummary(u)),
    bio: u.bio,
    links: Array.isArray(u.links) ? u.links : [],
    createdAt: u.createdAt,
    stats: userStats(u),
  };
}

export async function toMe(u: UserLite & { email: string; role: string; karmaTotal: number }) {
  return { ...(await toUserSummary(u)), email: u.email, role: u.role, karma: u.karmaTotal };
}

// ---------------------------------------------------------------- media

type MediaRow = {
  id: string;
  kind: string;
  status: string;
  storageKey: string;
  variants: unknown;
  originalName: string;
  sizeBytes: bigint;
  sortOrder: number;
};

export function toMedia(m: MediaRow) {
  const stored = asStored(m.variants);
  const variants: Variants = {};
  for (const [name, value] of Object.entries(stored)) {
    if (name === 'rejectReason') continue; // not a file
    const url = mediaUrl(variantKey(value));
    if (url) variants[(name === 'mp4_720p' ? 'mp4' : name) as keyof Variants] = url; // the worker calls the 720p video `mp4_720p`
  }
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    // Builds are only reachable through GET /games/:id/download (counted + short-lived URL).
    url: m.kind === 'build' ? null : mediaUrl(m.storageKey),
    variants,
    originalName: m.originalName,
    sizeBytes: Number(m.sizeBytes),
    sortOrder: m.sortOrder,
    rejectReason: typeof stored.rejectReason === 'string' ? stored.rejectReason : null,
  };
}

// ---------------------------------------------------------------- games

export const gameSummaryInclude = { owner: { select: userLiteSelect } } satisfies Prisma.GameInclude;
export type GameRow = Prisma.GameGetPayload<{ include: typeof gameSummaryInclude }>;

export async function toGameSummaries(rows: GameRow[], viewerId: string | null | undefined) {
  if (!rows.length) return [];
  const [media, owners, likes] = await Promise.all([
    mediaUrlMap(rows.map((g) => g.coverMediaId), 'card'),
    userSummaryMap(rows.map((g) => g.owner)),
    viewerId
      ? prisma.gameLike.findMany({ where: { userId: viewerId, gameId: { in: rows.map((g) => g.id) } }, select: { gameId: true } })
      : Promise.resolve([]),
  ]);
  const liked = new Set(likes.map((l) => l.gameId));
  return rows.map((g) => ({
    id: g.id,
    slug: g.slug,
    title: g.title,
    shortDescription: g.shortDescription,
    tags: g.tags,
    platforms: g.platforms,
    coverUrl: (g.coverMediaId && media.get(g.coverMediaId)) || null,
    owner: owners.get(g.owner.id)!,
    status: g.status,
    likesCount: g.likesCount,
    downloadsCount: g.downloadsCount,
    commentsCount: g.commentsCount,
    reviewsCount: g.reviewsCount,
    ratingAvg: round2(g.ratingAvg),
    publishedAt: g.publishedAt,
    likedByMe: liked.has(g.id),
  }));
}

export async function toGameDetail(row: GameRow, viewer: AuthUser | null) {
  const [summary] = await toGameSummaries([row], viewer?.id);
  const canSeeAll = !!viewer && (viewer.id === row.ownerId || viewer.role === 'admin');
  const [media, myReview] = await Promise.all([
    prisma.media.findMany({
      where: { gameId: row.id, ...(canSeeAll ? {} : { status: 'ready' }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    viewer
      ? prisma.review.findUnique({ where: { gameId_userId: { gameId: row.id, userId: viewer.id } }, include: { user: { select: userLiteSelect } } })
      : Promise.resolve(null),
  ]);
  const cover = media.find((m) => m.id === row.coverMediaId) ?? null;
  const coverRow = cover ?? (row.coverMediaId ? await prisma.media.findFirst({ where: { id: row.coverMediaId, status: 'ready' } }) : null);
  return {
    ...summary!,
    description: row.description,
    version: row.version,
    cover: coverRow ? toMedia(coverRow) : null,
    screenshots: media.filter((m) => m.kind === 'screenshot').map(toMedia),
    video: (() => {
      const v = media.find((m) => m.kind === 'video');
      return v ? toMedia(v) : null;
    })(),
    builds: media.filter((m) => m.kind === 'build').map(toMedia),
    myReview: myReview ? (await toReviews([myReview]))[0]! : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------- reviews

type ReviewRow = {
  id: string;
  gameId: string;
  rating: number;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  user: UserLite;
};

export async function toReviews(rows: ReviewRow[]) {
  const users = await userSummaryMap(rows.map((r) => r.user));
  return rows.map((r) => ({
    id: r.id,
    gameId: r.gameId,
    user: users.get(r.user.id)!,
    rating: r.rating,
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

// ---------------------------------------------------------------- comments

type CommentRow = {
  id: string;
  gameId: string;
  parentId: string | null;
  kind: string;
  body: string;
  acceptedAt: Date | null;
  likesCount: number;
  deletedAt: Date | null;
  createdAt: Date;
  user: UserLite;
};

export function toComment(c: CommentRow, users: Map<string, UserSummary>, liked: Set<string>) {
  const deleted = c.deletedAt !== null;
  return {
    id: c.id,
    gameId: c.gameId,
    parentId: c.parentId,
    kind: c.kind,
    body: deleted ? null : c.body,
    deleted,
    user: deleted ? null : users.get(c.user.id)!,
    acceptedAt: c.acceptedAt,
    likesCount: c.likesCount,
    likedByMe: liked.has(c.id),
    createdAt: c.createdAt,
  };
}
