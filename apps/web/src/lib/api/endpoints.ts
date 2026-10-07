import { api, ApiError } from "./client";
import type {
  ActivityItem,
  Comment,
  CommentKind,
  FeedBadge,
  Game,
  GameDetail,
  GameInput,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardType,
  LikeResult,
  Me,
  Media,
  Page,
  ProfileReview,
  ReportTarget,
  Review,
  ReviewPage,
  SearchSuggestResponse,
  TagCount,
  UploadInit,
  UploadRequest,
  UserCard,
  UserLink,
  UserProfile,
  UserSummary,
} from "./types";

type Cursor = { cursor?: string | null; limit?: number };

/* ------------------------------------------------------------------ */
/* Normalisation: the contract allows variants as plain URLs (Agent 1) */
/* or `{ url }` objects with `mp4_720p` (Agent 3's note). Accept both.  */
/* ------------------------------------------------------------------ */

type RawVariant = string | { url?: string } | undefined | null;
interface RawMedia extends Omit<Media, "variants"> {
  variants?: Record<string, RawVariant>;
}

const variantUrl = (v: RawVariant): string | undefined => (typeof v === "string" ? v : (v?.url ?? undefined));

export function normalizeMedia(m: RawMedia | null | undefined): Media | null {
  if (!m) return null;
  const v = m.variants ?? {};
  return {
    ...m,
    url: m.url ?? null,
    variants: {
      thumb: variantUrl(v.thumb),
      card: variantUrl(v.card),
      full: variantUrl(v.full),
      poster: variantUrl(v.poster),
      mp4: variantUrl(v.mp4) ?? variantUrl(v.mp4_720p),
    },
  };
}

type RawGameDetail = Omit<GameDetail, "cover" | "screenshots" | "video" | "builds"> & {
  cover: RawMedia | null;
  screenshots?: RawMedia[];
  video: RawMedia | null;
  builds?: RawMedia[];
};

export function normalizeGame(raw: RawGameDetail): GameDetail {
  return {
    ...raw,
    cover: normalizeMedia(raw.cover),
    screenshots: (raw.screenshots ?? []).map((s) => normalizeMedia(s)!).sort((a, b) => a.sortOrder - b.sortOrder),
    video: normalizeMedia(raw.video),
    builds: (raw.builds ?? []).map((b) => normalizeMedia(b)!),
  };
}

const game = (p: Promise<{ game: RawGameDetail }>) => p.then((r) => normalizeGame(r.game));
/** Feed items are `{ badge, game }`; flatten to a Game with a badge. */
const flattenFeed = (items: { badge?: FeedBadge | null; game: Game }[]): Game[] => items.map((i) => ({ ...i.game, badge: i.badge ?? null }));

/* ------------------------------------------------------------------ */

export const auth = {
  /** `null` when logged out (the API answers 401). */
  me: () =>
    api<{ user: Me }>("/auth/me").then(
      (r) => r.user,
      (e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      },
    ),
  login: (body: { identifier: string; password: string }) => api<{ user: Me }>("/auth/login", { method: "POST", body }),
  register: (body: { username: string; email: string; password: string; displayName?: string }) =>
    api<{ user: Me }>("/auth/register", { method: "POST", body }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
};

export const users = {
  get: (username: string) => api<{ user: UserProfile }>(`/users/${encodeURIComponent(username)}`).then((r) => r.user),
  update: (body: { displayName?: string; bio?: string; links?: UserLink[]; avatarMediaId?: string | null }) =>
    api<{ user: UserProfile }>("/users/me", { method: "PATCH", body }).then((r) => r.user),
  /** `status: "all"` is honoured for your own profile only (drafts and unpublished games). */
  games: (username: string, q: Cursor & { status?: "published" | "draft" | "unpublished" | "all" } = {}) =>
    api<Page<Game>>(`/users/${encodeURIComponent(username)}/games`, { query: q }),
  reviews: (username: string, q: Cursor = {}) => api<Page<ProfileReview>>(`/users/${encodeURIComponent(username)}/reviews`, { query: q }),
  /** Last 30 public items, no pagination. */
  activity: (username: string) => api<{ items: ActivityItem[] }>(`/users/${encodeURIComponent(username)}/activity`).then((r) => r.items),
};

export const games = {
  get: (idOrSlug: string) => game(api(`/games/${encodeURIComponent(idOrSlug)}`)),
  create: (body: GameInput) => game(api("/games", { method: "POST", body })),
  update: (id: string, body: GameInput) => game(api(`/games/${id}`, { method: "PATCH", body })),
  publish: (id: string) => game(api(`/games/${id}/publish`, { method: "POST" })),
  unpublish: (id: string) => game(api(`/games/${id}/unpublish`, { method: "POST" })),
  remove: (id: string) => api<void>(`/games/${id}`, { method: "DELETE" }),
  like: (id: string) => api<LikeResult>(`/games/${id}/like`, { method: "PUT" }),
  unlike: (id: string) => api<LikeResult>(`/games/${id}/like`, { method: "DELETE" }),
};

export const reviews = {
  list: (gameId: string, q: Cursor = {}) => api<ReviewPage>(`/games/${gameId}/reviews`, { query: q }),
  create: (gameId: string, body: { rating: number; body: string }) =>
    api<{ review: Review; karmaAwarded?: number }>(`/games/${gameId}/reviews`, { method: "POST", body }),
  update: (id: string, body: { rating?: number; body?: string }) =>
    api<{ review: Review; karmaAwarded?: number }>(`/reviews/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<{ karmaAwarded?: number }>(`/reviews/${id}`, { method: "DELETE" }),
};

export const comments = {
  list: (gameId: string, q: Cursor & { kind?: "all" | CommentKind; sort?: "top" | "new" } = {}) =>
    api<Page<Comment>>(`/games/${gameId}/comments`, { query: q }),
  create: (gameId: string, body: { body: string; kind: CommentKind; parentId?: string }) =>
    api<{ comment: Comment; karmaAwarded?: number }>(`/games/${gameId}/comments`, { method: "POST", body }),
  remove: (id: string) => api<{ karmaAwarded?: number }>(`/comments/${id}`, { method: "DELETE" }),
  like: (id: string) => api<LikeResult>(`/comments/${id}/like`, { method: "PUT" }),
  unlike: (id: string) => api<LikeResult>(`/comments/${id}/like`, { method: "DELETE" }),
  accept: (id: string) => api<{ comment: Comment }>(`/comments/${id}/accept`, { method: "POST" }),
  unaccept: (id: string) => api<{ comment: Comment }>(`/comments/${id}/accept`, { method: "DELETE" }),
};

export const feed = {
  list: (q: Cursor = {}) =>
    api<{ items: { badge?: FeedBadge | null; game: Game }[]; nextCursor: string | null }>("/feed", { query: q }).then((r) => ({
      items: flattenFeed(r.items),
      nextCursor: r.nextCursor,
    })),
  buzzing: () => api<{ items: { badge?: FeedBadge | null; game: Game }[] }>("/feed/buzzing").then((r) => ({ items: flattenFeed(r.items) })),
};

export const leaderboard = {
  get: (type: LeaderboardType, period: LeaderboardPeriod) =>
    api<{ items: LeaderboardEntry[] }>("/leaderboard", { query: { type, period, limit: 50 } }),
};

export const search = {
  games: (q: string, tags: string[], cursor?: string | null) => api<Page<Game>>("/search", { query: { q, type: "games", tags, cursor } }),
  users: (q: string, cursor?: string | null) => api<Page<UserCard>>("/search", { query: { q, type: "users", cursor } }),
  suggest: (q: string, signal?: AbortSignal) => api<SearchSuggestResponse>("/search/suggest", { query: { q }, signal }),
  popularTags: () => api<{ items: TagCount[] }>("/tags/popular").then((r) => r.items),
};

export const reports = {
  create: (body: { targetType: ReportTarget; targetId: string; reason: string }) =>
    api<{ report: { id: string } }>("/reports", { method: "POST", body }),
};

export const uploads = {
  init: (gameId: string, body: UploadRequest) => api<UploadInit>(`/games/${gameId}/uploads`, { method: "POST", body }),
  initAvatar: (body: UploadRequest) => api<UploadInit>("/users/me/uploads", { method: "POST", body }),
  complete: (uploadId: string) => api<{ media: RawMedia }>(`/uploads/${uploadId}/complete`, { method: "POST" }).then((r) => normalizeMedia(r.media)!),
  status: (uploadId: string) => api<{ media: RawMedia }>(`/uploads/${uploadId}`).then((r) => normalizeMedia(r.media)!),
  removeMedia: (mediaId: string) => api<void>(`/media/${mediaId}`, { method: "DELETE" }),
  /** Screenshots in their new order. */
  reorder: (gameId: string, mediaIds: string[]) => api<{ items: RawMedia[] }>(`/games/${gameId}/media/order`, { method: "PATCH", body: { mediaIds } }),
};

export type { UserSummary };
