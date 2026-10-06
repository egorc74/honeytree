/**
 * In-memory fake backend state for MSW. Mirrors the data model in PLAN.md §3.1,
 * implements the karma rules in §1.7, and serialises to the API shapes in
 * `lib/api/types.ts`. Persists to sessionStorage in the browser so a page reload
 * does not wipe the session during manual testing and Playwright runs.
 */
import type {
  CommentKind,
  FeedBadge,
  Game,
  GameDetail,
  GameStatus,
  MediaItem,
  MediaStatus,
  Platform,
  Review,
  Comment,
  User,
  UserLinks,
  UserProfile,
  UserStats,
  UserSummary,
} from "@/lib/api/types";
import { hashString, placeholderAvatar, placeholderImage } from "./placeholder";

export interface DbUser {
  id: string;
  username: string;
  email: string;
  password: string;
  displayName: string;
  bio: string;
  links: UserLinks;
  role: "user" | "admin";
  avatarUrl: string | null;
  createdAt: string;
}

export interface DbGame {
  id: string;
  slug: string;
  ownerId: string;
  title: string;
  shortDescription: string;
  description: string;
  tags: string[];
  platforms: Platform[];
  version: string;
  status: GameStatus;
  coverMediaId: string | null;
  media: DbMedia[];
  baseDownloads: number;
  rising: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export interface DbMedia {
  id: string;
  gameId: string | null;
  kind: MediaItem["kind"];
  originalName: string;
  mime: string;
  sizeBytes: number;
  status: MediaStatus;
  seed: string;
  sortOrder: number;
  /** epoch ms the scan/process pipeline started, for the simulated status progression */
  pipelineStartedAt?: number;
}

export interface DbReview {
  id: string;
  gameId: string;
  userId: string;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface DbComment {
  id: string;
  gameId: string;
  parentId: string | null;
  userId: string;
  kind: CommentKind;
  body: string;
  acceptedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface KarmaEvent {
  id: string;
  userId: string;
  amount: number;
  reason: "like_game" | "like_comment" | "comment" | "suggestion" | "review" | "suggestion_accepted" | "reversal";
  refType: string;
  refId: string;
  createdAt: string;
}

export interface DbState {
  version: number;
  seq: number;
  users: DbUser[];
  games: DbGame[];
  gameLikes: { userId: string; gameId: string; createdAt: string }[];
  commentLikes: { userId: string; commentId: string; createdAt: string }[];
  reviews: DbReview[];
  comments: DbComment[];
  karma: KarmaEvent[];
  downloads: { gameId: string; who: string; createdAt: string }[];
  reports: { id: string; reporterId: string; targetType: string; targetId: string; reason: string; createdAt: string }[];
  uploads: Record<string, { mediaId: string; gameId: string }>;
  sessionUserId: string | null;
}

const DB_VERSION = 3;
const STORAGE_KEY = "honeytree-mock-db";
const DAY = 86_400_000;

export const DAILY_LIKE_KARMA_CAP = 50;
export const DAILY_KARMA_CAP = 100;
export const KARMA_RULES = { like_game: 1, like_comment: 1, comment: 2, suggestion: 3, review: 3, suggestion_accepted: 10 } as const;
export const MIN_REVIEW_KARMA_LENGTH = 20;

export const TAGS = [
  "platformer", "puzzle", "rpg", "roguelike", "horror", "cozy", "pixel-art", "multiplayer",
  "strategy", "racing", "shooter", "adventure", "visual-novel", "sandbox", "tower-defense", "retro",
];

let state: DbState | null = null;

/* ------------------------------ seeding ------------------------------ */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USERNAMES = [
  "demo", "queenbee", "waxwing", "combcrafter", "nectarnerd", "pixelpollen", "hivemind", "stingerstudio",
  "dronedev", "royaljelly", "bumblebyte", "honeydew", "apiarist", "buzzkill", "swarmgames", "propolis",
  "waggle", "larvalabs", "meadowmaker", "clover",
];
const ADJ = [
  "Sticky", "Golden", "Midnight", "Tiny", "Velvet", "Rusty", "Cosmic", "Lazy", "Fuzzy", "Neon",
  "Hollow", "Crimson", "Wandering", "Sleepy", "Electric", "Gentle", "Frozen", "Wild", "Secret", "Lucky",
];
const NOUN = [
  "Hive", "Meadow", "Dungeon", "Garden", "Rocket", "Lantern", "Harvest", "Labyrinth", "Courier", "Orchard",
  "Tower", "Voyage", "Bakery", "Circuit", "Kingdom", "Quarry", "Sanctuary", "Express", "Odyssey", "Workshop",
];
const BODIES = [
  "Honestly one of the best things I have played this month.", "The controls feel great and the art is lovely.",
  "Needs a bit more polish but the idea is fantastic.", "I got stuck on level 3, otherwise super fun.",
  "Soundtrack is a banger. Please release it separately!", "Runs smoothly on my old laptop too.",
  "Short but sweet. Finished it in one sitting.", "The difficulty curve is a little steep for me.",
];
const SUGGESTIONS = [
  "It would be great to have a rebindable keys menu.", "Please add a colorblind mode for the puzzle tiles.",
  "A speedrun timer would be a cool addition.", "Could you add controller vibration settings?",
];
const COMMENTS = [
  "Love the art style!", "How long did this take you to make?", "Just downloaded it, thanks for sharing.",
  "Is there a Linux build planned?", "The trailer sold me instantly.", "Found a secret room in the second level 👀",
];

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function newMedia(gameId: string, kind: DbMedia["kind"], name: string, order: number, seed: string): DbMedia {
  const mimes = { build: "application/zip", screenshot: "image/png", cover: "image/png", video: "video/mp4", avatar: "image/png" };
  return {
    id: `m_${hashString(seed + name + order).toString(36)}`,
    gameId,
    kind,
    originalName: name,
    mime: mimes[kind],
    sizeBytes: kind === "build" ? 40_000_000 + (hashString(seed) % 300_000_000) : kind === "video" ? 24_000_000 : 400_000,
    status: "ready",
    seed,
    sortOrder: order,
  };
}

function seedState(): DbState {
  const rand = rng(1337);
  const now = Date.now();
  const s: DbState = {
    version: DB_VERSION, seq: 1000, users: [], games: [], gameLikes: [], commentLikes: [], reviews: [],
    comments: [], karma: [], downloads: [], reports: [], uploads: {}, sessionUserId: null,
  };
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  USERNAMES.forEach((username, i) => {
    const display = username === "demo" ? "Demo Bee" : username.replace(/^./, (c) => c.toUpperCase());
    s.users.push({
      id: `u_${i + 1}`, username, email: `${username}@honeytree.dev`, password: "honeytree123", displayName: display,
      bio: i % 3 === 0 ? "Making small games with big hearts. Powered by tea and honey." : i % 3 === 1 ? "Indie dev. Pixel art enthusiast. Occasional game jam survivor." : "",
      links: i % 2 === 0 ? { website: `https://example.com/${username}`, github: `https://github.com/${username}` } : {},
      role: i === 1 ? "admin" : "user", avatarUrl: placeholderAvatar(username, display), createdAt: iso(now - (60 + i * 3) * DAY),
    });
  });

  for (let i = 0; i < 40; i++) {
    const title = `${ADJ[i % ADJ.length]} ${NOUN[(i * 7 + 3) % NOUN.length]}`;
    const owner = s.users[1 + (i % (s.users.length - 1))];
    const ageDays = i < 8 ? rand() * 12 : 10 + rand() * 80;
    const created = now - ageDays * DAY;
    const id = `g_${i + 1}`;
    const tags = [...new Set([pick(TAGS), pick(TAGS), pick(TAGS)])];
    const g: DbGame = {
      id, slug: slugify(title) + (i >= 20 ? `-${i}` : ""), ownerId: owner.id, title,
      shortDescription: `A ${tags[0]} game about ${NOUN[(i * 5) % NOUN.length].toLowerCase()}s, ${ADJ[(i * 3) % ADJ.length].toLowerCase()} secrets and a very determined bee.`,
      description: `# ${title}\n\n${title} is a **${tags[0]}** game made in ${Math.ceil(rand() * 9)} weeks.\n\n## Features\n\n- Hand-crafted levels\n- A cozy, *buzzing* soundtrack\n- Plays well with keyboard and controller\n\nFound a bug? Tell me in the comments. Read more at [my site](https://example.com).\n\n> Thanks for playing!`,
      tags, platforms: (["windows", "mac", "linux", "web", "android"] as Platform[]).filter(() => rand() > 0.5).concat("windows").filter((p, k, a) => a.indexOf(p) === k),
      version: `1.${Math.floor(rand() * 5)}.${Math.floor(rand() * 9)}`, status: "published", coverMediaId: null, media: [],
      baseDownloads: Math.floor(rand() * 900), rising: i % 6 === 2, publishedAt: iso(created), createdAt: iso(created - DAY),
    };
    const cover = newMedia(id, "cover", "cover.png", 0, `${g.slug}-cover`);
    g.coverMediaId = cover.id;
    g.media.push(cover, newMedia(id, "build", `${g.slug}-win.zip`, 0, g.slug));
    for (let k = 0; k < 3 + (i % 3); k++) g.media.push(newMedia(id, "screenshot", `shot-${k + 1}.png`, k, `${g.slug}-shot-${k}`));
    if (i % 2 === 0) g.media.push(newMedia(id, "video", "trailer.mp4", 0, `${g.slug}-trailer`));
    s.games.push(g);
  }

  // Engagement with spread-out timestamps, awarding karma through the real rules.
  for (const g of s.games) {
    const published = new Date(g.publishedAt!).getTime();
    const likeCount = g.rising ? 10 + Math.floor(rand() * 6) : Math.floor(rand() * 12);
    const users = [...s.users].sort(() => rand() - 0.5);
    for (const u of users.slice(0, likeCount)) {
      if (u.id === g.ownerId) continue;
      const at = g.rising ? now - rand() * 1.5 * DAY : published + rand() * (now - published);
      s.gameLikes.push({ userId: u.id, gameId: g.id, createdAt: iso(at) });
      awardKarma(s, { userId: u.id, reason: "like_game", refType: "game", refId: g.id, at });
    }
    const reviewers = users.slice(12, 12 + Math.floor(rand() * 4));
    for (const u of reviewers) {
      if (u.id === g.ownerId) continue;
      const at = published + rand() * (now - published);
      const body = pick(BODIES);
      s.reviews.push({ id: `r_${s.seq++}`, gameId: g.id, userId: u.id, rating: 3 + Math.floor(rand() * 3), body, createdAt: iso(at), updatedAt: iso(at) });
      if (body.length >= MIN_REVIEW_KARMA_LENGTH) awardKarma(s, { userId: u.id, reason: "review", refType: "game", refId: g.id, at });
    }
    const commenters = users.slice(4, 4 + Math.floor(rand() * 5));
    commenters.forEach((u, idx) => {
      const at = published + rand() * (now - published);
      const kind: CommentKind = idx % 3 === 0 ? "suggestion" : "comment";
      const c: DbComment = {
        id: `c_${s.seq++}`, gameId: g.id, parentId: null, userId: u.id, kind,
        body: kind === "suggestion" ? pick(SUGGESTIONS) : pick(COMMENTS), acceptedAt: null, deletedAt: null, createdAt: iso(at),
      };
      s.comments.push(c);
      awardKarma(s, { userId: u.id, reason: kind, refType: "comment", refId: c.id, at });
      if (idx === 0 && kind === "suggestion" && rand() > 0.5) c.acceptedAt = iso(at + DAY / 4);
      if (idx % 2 === 1) {
        const rep: DbComment = { id: `c_${s.seq++}`, gameId: g.id, parentId: c.id, userId: g.ownerId, kind: "comment", body: "Thanks for the feedback! 🐝", acceptedAt: null, deletedAt: null, createdAt: iso(at + DAY / 8) };
        s.comments.push(rep);
      }
      if (rand() > 0.5) {
        const liker = pick(users);
        if (liker.id !== u.id) {
          s.commentLikes.push({ userId: liker.id, commentId: c.id, createdAt: iso(at + 1000) });
          awardKarma(s, { userId: liker.id, reason: "like_comment", refType: "comment", refId: c.id, at: at + 1000 });
        }
      }
    });
  }
  s.games.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The demo user has a published game, a draft and an unpublished game for the profile "manage" UI.
  return s;
}

export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "game";
}

/* --------------------------- state / persistence --------------------------- */

export function db(): DbState {
  if (state) return state;
  if (typeof window !== "undefined") {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DbState;
        if (parsed.version === DB_VERSION) return (state = parsed);
      }
    } catch {
      /* ignore */
    }
  }
  return (state = seedState());
}

export function resetDb() {
  state = seedState();
  persist();
}

export function persist() {
  if (typeof window === "undefined" || !state) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode: ignore */
  }
}

export function nextId(prefix: string): string {
  const s = db();
  return `${prefix}_${s.seq++}`;
}

/* -------------------------------- karma -------------------------------- */

const LIKE_REASONS = new Set(["like_game", "like_comment"]);

export function awardKarma(
  s: DbState,
  e: { userId: string; reason: Exclude<KarmaEvent["reason"], "reversal">; refType: string; refId: string; at?: number },
): number {
  const at = e.at ?? Date.now();
  let amount: number = KARMA_RULES[e.reason];
  const day = iso(at).slice(0, 10);
  const today = s.karma.filter((k) => k.userId === e.userId && k.createdAt.slice(0, 10) === day && k.amount > 0);
  const total = today.reduce((n, k) => n + k.amount, 0);
  const likes = today.filter((k) => LIKE_REASONS.has(k.reason)).reduce((n, k) => n + k.amount, 0);
  if (LIKE_REASONS.has(e.reason)) amount = Math.min(amount, DAILY_LIKE_KARMA_CAP - likes);
  amount = Math.min(amount, DAILY_KARMA_CAP - total);
  if (amount <= 0) return 0;
  s.karma.push({ id: `k_${s.seq++}`, userId: e.userId, amount, reason: e.reason, refType: e.refType, refId: e.refId, createdAt: iso(at) });
  return amount;
}

/** Undoing an action reverses what it earned (net of earlier reversals). */
export function reverseKarma(s: DbState, userId: string, refType: string, refId: string, reason: KarmaEvent["reason"]): number {
  const net = s.karma
    .filter((k) => k.userId === userId && k.refType === refType && k.refId === refId && (k.reason === reason || k.reason === "reversal"))
    .reduce((n, k) => n + k.amount, 0);
  if (net <= 0) return 0;
  s.karma.push({ id: `k_${s.seq++}`, userId, amount: -net, reason: "reversal", refType, refId, createdAt: iso(Date.now()) });
  return net;
}

export function karmaTotal(s: DbState, userId: string, since = 0): number {
  return s.karma.filter((k) => k.userId === userId && new Date(k.createdAt).getTime() >= since).reduce((n, k) => n + k.amount, 0);
}

/* ------------------------------ serialisation ------------------------------ */

export function userSummary(u: DbUser): UserSummary {
  return { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
}

export function toUser(u: DbUser, includeEmail = false): User {
  return {
    ...userSummary(u), ...(includeEmail ? { email: u.email } : {}), bio: u.bio, links: u.links, role: u.role, createdAt: u.createdAt,
  };
}

export function userStats(s: DbState, u: DbUser): UserStats {
  const own = s.games.filter((g) => g.ownerId === u.id && g.status === "published");
  const ids = new Set(own.map((g) => g.id));
  const rs = s.reviews.filter((r) => ids.has(r.gameId));
  return {
    likesReceived: s.gameLikes.filter((l) => ids.has(l.gameId)).length,
    gamesCount: own.length,
    ratingAvg: rs.length ? Math.round((rs.reduce((n, r) => n + r.rating, 0) / rs.length) * 10) / 10 : null,
    ratingCount: rs.length,
    karma: karmaTotal(s, u.id),
  };
}

export function toProfile(s: DbState, u: DbUser, includeEmail = false): UserProfile {
  return { ...toUser(u, includeEmail), stats: userStats(s, u) };
}

export function mediaItem(m: DbMedia): MediaItem {
  const variants =
    m.kind === "video"
      ? { mp4: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4", poster: placeholderImage(m.seed, "▶ Trailer", 1280, 720) }
      : m.kind === "build"
        ? {}
        : { thumb: placeholderImage(m.seed, "", 320, 180), card: placeholderImage(m.seed, "", 640, 360), full: placeholderImage(m.seed, "", 1600, 900) };
  return { id: m.id, kind: m.kind, status: m.status, originalName: m.originalName, mime: m.mime, sizeBytes: m.sizeBytes, variants, sortOrder: m.sortOrder };
}

function coverVariants(g: DbGame) {
  const m = g.media.find((x) => x.id === g.coverMediaId);
  if (!m || m.status !== "ready") return null;
  return {
    thumb: placeholderImage(m.seed + g.title, g.title, 320, 180),
    card: placeholderImage(m.seed + g.title, g.title, 640, 360),
    full: placeholderImage(m.seed + g.title, g.title, 1600, 900),
  };
}

export function gameStats(s: DbState, g: DbGame) {
  const rs = s.reviews.filter((r) => r.gameId === g.id);
  return {
    likesCount: s.gameLikes.filter((l) => l.gameId === g.id).length,
    downloadsCount: g.baseDownloads + s.downloads.filter((d) => d.gameId === g.id).length,
    commentsCount: s.comments.filter((c) => c.gameId === g.id && !c.deletedAt).length,
    reviewsCount: rs.length,
    ratingAvg: rs.length ? Math.round((rs.reduce((n, r) => n + r.rating, 0) / rs.length) * 10) / 10 : null,
  };
}

export function toGame(s: DbState, g: DbGame, me: string | null, badge?: FeedBadge): Game {
  const owner = s.users.find((u) => u.id === g.ownerId)!;
  return {
    id: g.id, slug: g.slug, title: g.title, shortDescription: g.shortDescription, tags: g.tags, platforms: g.platforms,
    version: g.version, status: g.status, cover: coverVariants(g), owner: userSummary(owner), ...gameStats(s, g),
    publishedAt: g.publishedAt, createdAt: g.createdAt, likedByMe: !!me && s.gameLikes.some((l) => l.gameId === g.id && l.userId === me),
    ...(badge ? { badge } : {}),
  };
}

export function toReview(s: DbState, r: DbReview): Review {
  const u = s.users.find((x) => x.id === r.userId)!;
  return { id: r.id, gameId: r.gameId, user: userSummary(u), rating: r.rating, body: r.body, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function toComment(s: DbState, c: DbComment, me: string | null): Comment {
  const u = s.users.find((x) => x.id === c.userId)!;
  const deleted = !!c.deletedAt;
  return {
    id: c.id, gameId: c.gameId, parentId: c.parentId, user: userSummary(u), kind: c.kind, body: deleted ? "" : c.body,
    acceptedAt: c.acceptedAt, likesCount: s.commentLikes.filter((l) => l.commentId === c.id).length,
    likedByMe: !!me && s.commentLikes.some((l) => l.commentId === c.id && l.userId === me), deletedAt: c.deletedAt, createdAt: c.createdAt,
  };
}

export function toGameDetail(s: DbState, g: DbGame, me: string | null): GameDetail {
  const ready = (kind: DbMedia["kind"]) => g.media.filter((m) => m.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder).map(mediaItem);
  const mine = me ? s.reviews.find((r) => r.gameId === g.id && r.userId === me) : undefined;
  return {
    ...toGame(s, g, me), description: g.description, coverMedia: g.media.find((m) => m.id === g.coverMediaId && m.kind === "cover") ? mediaItem(g.media.find((m) => m.id === g.coverMediaId)!) : null,
    screenshots: ready("screenshot"),
    video: ready("video")[0] ?? null, builds: ready("build"), myReview: mine ? toReview(s, mine) : null,
  };
}

/* --------------------------------- feed --------------------------------- */

export function engagement(s: DbState, g: DbGame, sinceMs: number, untilMs = Date.now()): number {
  const within = (t: string) => new Date(t).getTime() >= sinceMs && new Date(t).getTime() <= untilMs;
  return (
    3 * s.gameLikes.filter((l) => l.gameId === g.id && l.userId !== g.ownerId && within(l.createdAt)).length +
    4 * s.reviews.filter((r) => r.gameId === g.id && r.userId !== g.ownerId && within(r.createdAt)).length +
    2 * s.comments.filter((c) => c.gameId === g.id && c.userId !== g.ownerId && !c.deletedAt && within(c.createdAt)).length +
    s.downloads.filter((d) => d.gameId === g.id && within(d.createdAt)).length
  );
}

export function feedLists(s: DbState) {
  const now = Date.now();
  const published = s.games.filter((g) => g.status === "published" && g.coverMediaId);
  const buzzing = published
    .map((g) => ({ g, e24: engagement(s, g, now - DAY) }))
    .filter((x) => x.e24 >= 5 && now - new Date(x.g.publishedAt!).getTime() <= 90 * DAY)
    .sort((a, b) => b.e24 - a.e24)
    .map((x) => x.g);
  const fresh = published
    .filter((g) => now - new Date(g.publishedAt!).getTime() <= 14 * DAY)
    .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());
  const sweetest = [...published].sort((a, b) => gameStats(s, b).likesCount - gameStats(s, a).likesCount);
  return { buzzing, fresh, sweetest };
}

/** Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest, … without duplicates. */
export function mixedFeed(s: DbState): { game: DbGame; badge: FeedBadge }[] {
  const { buzzing, fresh, sweetest } = feedLists(s);
  const lists: Record<FeedBadge, DbGame[]> = { buzzing: [...buzzing], fresh: [...fresh], sweetest: [...sweetest] };
  const pattern: FeedBadge[] = ["buzzing", "fresh", "sweetest", "fresh", "buzzing", "sweetest"];
  const seen = new Set<string>();
  const out: { game: DbGame; badge: FeedBadge }[] = [];
  const take = (badge: FeedBadge) => {
    const l = lists[badge];
    while (l.length) {
      const g = l.shift()!;
      if (!seen.has(g.id)) {
        seen.add(g.id);
        out.push({ game: g, badge });
        return true;
      }
    }
    return false;
  };
  let guard = 0;
  while ((lists.buzzing.length || lists.fresh.length || lists.sweetest.length) && guard++ < 1000) {
    for (const b of pattern) take(b);
  }
  // Everything else, newest first.
  for (const g of [...s.games].filter((x) => x.status === "published" && x.coverMediaId && !seen.has(x.id)).sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))) {
    out.push({ game: g, badge: "fresh" });
  }
  return out;
}

export function currentUser(s: DbState): DbUser | null {
  return s.sessionUserId ? (s.users.find((u) => u.id === s.sessionUserId) ?? null) : null;
}

export function periodStart(period: string | null): number {
  const now = Date.now();
  return period === "week" ? now - 7 * DAY : period === "month" ? now - 30 * DAY : 0;
}
