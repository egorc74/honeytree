import { api, ApiError } from "./client";
import type {
  ActivityItem,
  Comment,
  CommentKind,
  Game,
  GameDetail,
  GameInput,
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardType,
  LikeResult,
  Page,
  ProfileReview,
  ReportTarget,
  Review,
  SearchResponse,
  SearchSuggestResponse,
  UploadInit,
  UploadRequest,
  UploadStatus,
  User,
  UserLinks,
  UserProfile,
  UserSummary,
} from "./types";

type Cursor = { cursor?: string | null; limit?: number };

export const auth = {
  /** `null` when logged out (the API answers 401). */
  me: () =>
    api<{ user: User }>("/auth/me").then(
      (r) => r.user,
      (e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      },
    ),
  login: (body: { email: string; password: string }) => api<{ user: User }>("/auth/login", { method: "POST", body }),
  register: (body: { username: string; email: string; password: string }) =>
    api<{ user: User }>("/auth/register", { method: "POST", body }),
  logout: () => api<void>("/auth/logout", { method: "POST" }),
};

export const users = {
  get: (username: string) => api<UserProfile>(`/users/${encodeURIComponent(username)}`),
  update: (body: { displayName?: string; bio?: string; links?: UserLinks; avatarMediaId?: string }) =>
    api<User>("/users/me", { method: "PATCH", body }),
  games: (username: string, q: Cursor = {}) => api<Page<Game>>(`/users/${encodeURIComponent(username)}/games`, { query: q }),
  reviews: (username: string, q: Cursor = {}) =>
    api<Page<ProfileReview>>(`/users/${encodeURIComponent(username)}/reviews`, { query: q }),
  /** Not in the plan's contract yet — see docs/requests/agent2-activity-endpoint.md */
  activity: (username: string, q: Cursor = {}) =>
    api<Page<ActivityItem>>(`/users/${encodeURIComponent(username)}/activity`, { query: q }),
};

export const games = {
  get: (slug: string) => api<GameDetail>(`/games/${encodeURIComponent(slug)}`),
  create: (body: GameInput) => api<GameDetail>("/games", { method: "POST", body }),
  update: (id: string, body: GameInput) => api<GameDetail>(`/games/${id}`, { method: "PATCH", body }),
  publish: (id: string) => api<GameDetail>(`/games/${id}/publish`, { method: "POST" }),
  unpublish: (id: string) => api<GameDetail>(`/games/${id}/unpublish`, { method: "POST" }),
  remove: (id: string) => api<void>(`/games/${id}`, { method: "DELETE" }),
  like: (id: string) => api<LikeResult>(`/games/${id}/like`, { method: "PUT" }),
  unlike: (id: string) => api<LikeResult>(`/games/${id}/like`, { method: "DELETE" }),
  /** Download endpoint 302s to a presigned URL; navigate the browser to it. */
  downloadUrl: (id: string, base = "/api/v1") => `${base}/games/${id}/download`,
};

export const reviews = {
  list: (gameId: string, q: Cursor = {}) => api<Page<Review>>(`/games/${gameId}/reviews`, { query: q }),
  create: (gameId: string, body: { rating: number; body: string }) =>
    api<Review & { karmaAwarded?: number }>(`/games/${gameId}/reviews`, { method: "POST", body }),
  update: (id: string, body: { rating?: number; body?: string }) => api<Review>(`/reviews/${id}`, { method: "PATCH", body }),
  remove: (id: string) => api<void>(`/reviews/${id}`, { method: "DELETE" }),
};

export const comments = {
  list: (gameId: string, q: Cursor = {}) => api<Page<Comment>>(`/games/${gameId}/comments`, { query: q }),
  create: (gameId: string, body: { body: string; kind: CommentKind; parentId?: string }) =>
    api<Comment & { karmaAwarded?: number }>(`/games/${gameId}/comments`, { method: "POST", body }),
  remove: (id: string) => api<void>(`/comments/${id}`, { method: "DELETE" }),
  like: (id: string) => api<LikeResult>(`/comments/${id}/like`, { method: "PUT" }),
  unlike: (id: string) => api<LikeResult>(`/comments/${id}/like`, { method: "DELETE" }),
  accept: (id: string) => api<Comment>(`/comments/${id}/accept`, { method: "POST" }),
};

export const feed = {
  list: (q: Cursor = {}) => api<Page<Game>>("/feed", { query: q }),
  buzzing: () => api<{ items: Game[] }>("/feed/buzzing"),
};

export const leaderboard = {
  get: (type: LeaderboardType, period: LeaderboardPeriod) =>
    api<{ items: LeaderboardEntry[] }>("/leaderboard", { query: { type, period } }),
};

export const search = {
  games: (q: string, tags: string[], cursor?: string | null) =>
    api<SearchResponse<Game>>("/search", { query: { q, type: "games", tags, cursor } }),
  users: (q: string, cursor?: string | null) =>
    api<SearchResponse<UserSummary & { bio?: string; gamesCount?: number }>>("/search", {
      query: { q, type: "users", cursor },
    }),
  suggest: (q: string, signal?: AbortSignal) => api<SearchSuggestResponse>("/search/suggest", { query: { q }, signal }),
};

export const reports = {
  create: (body: { targetType: ReportTarget; targetId: string; reason: string }) =>
    api<{ id: string }>("/reports", { method: "POST", body }),
};

export const uploads = {
  init: (gameId: string, body: UploadRequest) => api<UploadInit>(`/games/${gameId}/uploads`, { method: "POST", body }),
  complete: (uploadId: string) => api<UploadStatus>(`/uploads/${uploadId}/complete`, { method: "POST" }),
  status: (uploadId: string) => api<UploadStatus>(`/uploads/${uploadId}`),
  /** Avatars are not game-bound — see docs/requests/agent2-avatar-upload.md */
  initAvatar: (body: UploadRequest) => api<UploadInit>("/users/me/uploads", { method: "POST", body }),
  removeMedia: (mediaId: string) => api<void>(`/media/${mediaId}`, { method: "DELETE" }),
  reorder: (gameId: string, body: { kind: "screenshot"; order: string[] }) =>
    api<void>(`/games/${gameId}/media/order`, { method: "PATCH", body }),
};
