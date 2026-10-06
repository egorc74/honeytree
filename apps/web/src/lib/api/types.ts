/**
 * API types the web app codes against. Source of truth: `docs/contract/openapi.yaml` (Agent 1)
 * and `docs/requests/agent3-to-agent2-upload-and-media.md` (Agent 3).
 * Responses are normalised in `endpoints.ts` (envelopes unwrapped, media variants flattened to URLs),
 * so components only ever see the shapes below. Fix contract mismatches HERE and file a request;
 * do not work around them in components.
 */

export type Platform = "windows" | "mac" | "linux" | "web" | "android";
export type GameStatus = "draft" | "published" | "unpublished" | "removed";
export type FeedBadge = "fresh" | "sweetest" | "buzzing";
export type CommentKind = "comment" | "suggestion";
export type MediaKind = "build" | "screenshot" | "video" | "cover" | "avatar";
export type MediaStatus = "uploading" | "scanning" | "processing" | "ready" | "rejected";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface UserSummary {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface UserStats {
  likesReceived: number;
  gamesCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  karma: number;
}

export interface UserLink {
  label: string;
  url: string;
}

/** Logged-in user (`GET /auth/me`). */
export interface Me extends UserSummary {
  email: string;
  role: "user" | "admin";
  karma: number;
}

export interface UserProfile extends UserSummary {
  bio: string;
  links: UserLink[];
  createdAt: string;
  stats: UserStats;
}

/** Search result / leaderboard row for a user. */
export interface UserCard extends UserSummary {
  stats?: UserStats;
}

export interface MediaVariants {
  thumb?: string; // 320
  card?: string; // 640
  full?: string; // 1600
  mp4?: string; // 720p
  poster?: string;
}

export interface Media {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  url: string | null;
  variants: MediaVariants;
  originalName: string;
  sizeBytes: number;
  sortOrder: number;
  rejectReason?: string | null;
}

/** `GameSummary` in the contract: what lists, cards and the feed show. */
export interface Game {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  tags: string[];
  platforms: Platform[];
  /** 640px card variant */
  coverUrl: string | null;
  owner: UserSummary;
  status: GameStatus;
  likesCount: number;
  downloadsCount: number;
  commentsCount: number;
  reviewsCount: number;
  ratingAvg: number | null;
  publishedAt: string | null;
  likedByMe: boolean;
  /** Only on feed items. `null`/absent for the plain tail of the feed. */
  badge?: FeedBadge | null;
}

export interface GameDetail extends Game {
  description: string; // markdown
  version: string;
  cover: Media | null;
  screenshots: Media[];
  video: Media | null;
  builds: Media[];
  myReview: Review | null;
  createdAt: string;
  updatedAt: string;
}

export interface GameInput {
  title?: string;
  shortDescription?: string;
  description?: string;
  tags?: string[];
  platforms?: Platform[];
  version?: string;
  coverMediaId?: string | null;
}

export interface Review {
  id: string;
  gameId: string;
  user: UserSummary;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface RatingSummary {
  ratingAvg: number | null;
  ratingCount: number;
  distribution: Record<string, number>;
}

export interface ReviewPage extends Page<Review> {
  summary?: RatingSummary;
}

/** Review as listed on a profile ("Reviews written"): includes the game. */
export interface ProfileReview extends Review {
  game: { id: string; slug: string; title: string; coverUrl: string | null };
}

export interface Comment {
  id: string;
  gameId: string;
  parentId: string | null;
  kind: CommentKind;
  /** null when deleted */
  body: string | null;
  deleted: boolean;
  /** null when deleted */
  user: UserSummary | null;
  acceptedAt: string | null;
  likesCount: number;
  likedByMe: boolean;
  createdAt: string;
  /** Top-level comments only. */
  replies?: Comment[];
  repliesCount?: number;
}

export type LeaderboardType = "games" | "creators" | "karma";
export type LeaderboardPeriod = "week" | "month" | "all";

export interface LeaderboardEntry {
  rank: number;
  score: number;
  game?: Game;
  user?: UserCard;
}

export interface SearchSuggestResponse {
  games: { id: string; slug: string; title: string; coverUrl: string | null }[];
  users: UserSummary[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface ActivityItem {
  type: "comment" | "suggestion" | "review" | "like" | "published";
  createdAt: string;
  excerpt?: string | null;
  rating?: number | null;
  game: { id: string; slug: string; title: string };
}

/** Write endpoints that can earn/lose karma return this (positive = earned, negative = reversed). */
export interface KarmaAward {
  karmaAwarded?: number;
}

export interface LikeResult extends KarmaAward {
  liked: boolean;
  likesCount: number;
}

/** `POST /games/:id/uploads` (Agent 3): presigned PUT straight to storage. */
export interface UploadInit {
  /** equals `media.id` */
  uploadId: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  fields: Record<string, string>;
  expiresAt?: string;
  media: Media;
}

export interface UploadRequest {
  kind: MediaKind;
  filename: string;
  size: number;
  mime: string;
}

export type ReportTarget = "game" | "comment" | "review" | "user";
