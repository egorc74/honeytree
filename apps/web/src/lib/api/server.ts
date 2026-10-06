import { apiBase } from "./client";
import type { GameDetail, UserProfile } from "./types";

/** Server-side (RSC / generateMetadata) fetch. Returns null on any failure so pages degrade gracefully. */
async function serverGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: { Accept: "application/json" }, next: { revalidate: 60 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export const getGameServer = (slug: string) => serverGet<GameDetail>(`/games/${encodeURIComponent(slug)}`);
export const getProfileServer = (username: string) => serverGet<UserProfile>(`/users/${encodeURIComponent(username)}`);
