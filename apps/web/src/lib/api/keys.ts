import type { LeaderboardPeriod, LeaderboardType } from "./types";

export const keys = {
  me: ["me"] as const,
  feed: ["feed"] as const,
  buzzing: ["feed", "buzzing"] as const,
  game: (slug: string) => ["game", slug] as const,
  reviews: (gameId: string) => ["reviews", gameId] as const,
  comments: (gameId: string) => ["comments", gameId] as const,
  profile: (username: string) => ["profile", username] as const,
  userGames: (username: string) => ["user-games", username] as const,
  userReviews: (username: string) => ["user-reviews", username] as const,
  userActivity: (username: string) => ["user-activity", username] as const,
  leaderboard: (type: LeaderboardType, period: LeaderboardPeriod) => ["leaderboard", type, period] as const,
  suggest: (q: string) => ["suggest", q] as const,
  searchGames: (q: string, tags: string[]) => ["search", "games", q, [...tags].sort()] as const,
  searchUsers: (q: string) => ["search", "users", q] as const,
};
