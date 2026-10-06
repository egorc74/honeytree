/**
 * API types the web app codes against (PLAN.md §3.1/§3.2).
 *
 * Source of truth is `docs/contract/openapi.yaml` (Agent 1). Until it lands these
 * are hand-written from the plan; shapes the plan leaves open are listed in
 * `docs/requests/agent2-*.md`. When the real contract differs, fix it HERE
 * (one place) and file a request rather than working around it in components.
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
  error: { code: string; message: string };
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

export interface UserLinks {
  website?: string;
  github?: string;
  itch?: string;
  twitter?: string;
  discord?: string;
}

export interface User extends UserSummary {
  email?: string; // only for `me`
  bio: string;
  links: UserLinks;
  role: "user" | "admin";
  createdAt: string;
}

export interface UserProfile extends User {
  stats: UserStats;
}

export interface MediaVariants {
  thumb?: string; // 320
  card?: string; // 640
  full?: string; // 1600
  mp4?: string;
  poster?: string;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  originalName: string;
  mime: string;
  sizeBytes: number;
  variants: MediaVariants;
  sortOrder: number;
}

export interface Game {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  tags: string[];
  platforms: Platform[];
  version: string;
  status: GameStatus;
  cover: MediaVariants | null;
  owner: UserSummary;
  likesCount: number;
  downloadsCount: number;
  commentsCount: number;
  reviewsCount: number;
  ratingAvg: number | null;
  publishedAt: string | null;
  createdAt: string;
  likedByMe: boolean;
  /** Present on feed items only. */
  badge?: FeedBadge;
}

export interface GameDetail extends Game {
  description: string; // markdown
  /** The cover as a media record (id + processing status); `cover` has only the image variants. */
  coverMedia: MediaItem | null;
  screenshots: MediaItem[];
  video: MediaItem | null;
  builds: MediaItem[];
  myReview: Review | null;
}

export interface GameInput {
  title?: string;
  shortDescription?: string;
  description?: string;
  tags?: string[];
  platforms?: Platform[];
  version?: string;
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

/** Review as listed on a profile ("Reviews written"): includes the game. */
export interface ProfileReview extends Review {
  game: Pick<Game, "id" | "slug" | "title" | "cover">;
}

export interface Comment {
  id: string;
  gameId: string;
  parentId: string | null;
  user: UserSummary;
  kind: CommentKind;
  body: string;
  acceptedAt: string | null;
  likesCount: number;
  likedByMe: boolean;
  deletedAt: string | null;
  createdAt: string;
  /** One level of replies, inlined for top-level comments. */
  replies?: Comment[];
}

export interface FeedResponse extends Page<Game> {}

export type LeaderboardType = "games" | "creators" | "karma";
export type LeaderboardPeriod = "week" | "month" | "all";

export interface LeaderboardEntry {
  rank: number;
  /** games: Game, creators/karma: UserSummary */
  game?: Game;
  user?: UserSummary;
  /** the number the ranking is by (likes, likes received, karma) */
  score: number;
}

export interface SearchSuggestResponse {
  games: Pick<Game, "id" | "slug" | "title" | "cover" | "tags">[];
  users: UserSummary[];
}

export interface SearchResponse<T> extends Page<T> {
  facets?: { tags: { tag: string; count: number }[] };
}

export interface ActivityItem {
  id: string;
  type: "like_game" | "like_comment" | "comment" | "suggestion" | "review" | "publish" | "suggestion_accepted";
  createdAt: string;
  game: Pick<Game, "id" | "slug" | "title"> | null;
  excerpt?: string;
  karma?: number;
}

/** Returned by actions that can earn karma so the UI can show "+1 karma 🍯". */
export interface KarmaAward {
  karmaAwarded?: number;
}

export interface LikeResult extends KarmaAward {
  liked: boolean;
  likesCount: number;
}

export interface UploadInit {
  uploadId: string;
  url: string;
  fields: Record<string, string>;
  mediaId?: string;
}

export interface UploadStatus {
  uploadId: string;
  mediaId: string;
  status: MediaStatus;
  reason?: string;
}

export interface UploadRequest {
  kind: Exclude<MediaKind, "avatar"> | "avatar";
  filename: string;
  size: number;
  mime: string;
}

export type ReportTarget = "game" | "comment" | "review" | "user";
