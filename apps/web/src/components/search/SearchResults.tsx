"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoadMore } from "@/hooks/useInfinite";
import { search } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import { plural } from "@/lib/format";
import { GameCard } from "../GameCard";
import { EmptyState, ErrorState, GameGridSkeleton, HexAvatar, RowSkeleton, TabPanel, Tabs, cx } from "../ui";

type Tab = "games" | "users";
/** Shown when the API does not return tag facets. */
const FALLBACK_TAGS = ["platformer", "puzzle", "rpg", "roguelike", "horror", "cozy", "pixel-art", "multiplayer", "strategy", "adventure"];

export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = (params.get("q") ?? "").trim();
  const tab: Tab = params.get("type") === "users" ? "users" : "games";
  const tags = (params.get("tags") ?? "").split(",").filter(Boolean);

  function update(next: { type?: Tab; tags?: string[] }) {
    const p = new URLSearchParams(params.toString());
    if (next.type) next.type === "users" ? p.set("type", "users") : p.delete("type");
    if (next.tags) next.tags.length ? p.set("tags", next.tags.join(",")) : p.delete("tags");
    router.replace(`${pathname}?${p.toString()}`);
  }

  const games = useInfiniteQuery({
    queryKey: keys.searchGames(q, tags),
    queryFn: ({ pageParam }) => search.games(q, tags, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    // The API requires a query string; without one we show a prompt instead.
    enabled: tab === "games" && q.length > 0,
  });
  const creators = useInfiniteQuery({
    queryKey: keys.searchUsers(q),
    queryFn: ({ pageParam }) => search.users(q, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
    enabled: tab === "users" && q.length > 0,
  });

  const gameItems = games.data?.pages.flatMap((p) => p.items) ?? [];
  const userItems = creators.data?.pages.flatMap((p) => p.items) ?? [];
  const popular = useQuery({ queryKey: ["tags", "popular"], queryFn: search.popularTags, staleTime: 5 * 60_000 });
  const tagOptions = [...new Set([...tags, ...(popular.data?.map((t) => t.tag) ?? FALLBACK_TAGS)])].slice(0, 14);

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl font-semibold">{q ? <>Results for “{q}”</> : "Search"}</h1>
      <Tabs
        idPrefix="search"
        label="Search results"
        value={tab}
        onChange={(t) => update({ type: t })}
        items={[
          { value: "games", label: "Games" },
          { value: "users", label: "Creators" },
        ]}
      />

      <TabPanel idPrefix="search" value="games" active={tab === "games"}>
        <div className="space-y-5">
          <div role="group" aria-label="Filter by tag" className="flex flex-wrap gap-2">
            {tagOptions.map((t) => {
              const on = tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => update({ tags: on ? tags.filter((x) => x !== t) : [...tags, t] })}
                  className={cx(
                    "rounded-pill border-2 px-3 py-1 text-sm font-medium transition-colors",
                    on ? "border-transparent bg-primary text-primary-fg" : "border-line bg-raised hover:border-primary",
                  )}
                >
                  #{t}
                </button>
              );
            })}
            {tags.length > 0 && (
              <button type="button" onClick={() => update({ tags: [] })} className="px-2 text-sm text-link underline">
                Clear filters
              </button>
            )}
          </div>

          {!q ? (
            <EmptyState title="Search for games" description="Type a title or a tag in the search bar above." emoji="🔍" />
          ) : games.isLoading ? (
            <GameGridSkeleton count={6} />
          ) : games.isError ? (
            <ErrorState onRetry={() => games.refetch()} />
          ) : gameItems.length === 0 ? (
            <EmptyState title="No games found" description={q ? `Nothing matched “${q}”. Try a different spelling or fewer filters.` : "Try a different filter."} emoji="🔍" />
          ) : (
            <>
              <p className="text-muted" aria-live="polite">
                {plural(gameItems.length, "game")}
                {games.hasNextPage ? "+" : ""} found
              </p>
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Game results">
                {gameItems.map((g) => (
                  <li key={g.id}>
                    <GameCard game={g} />
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={!!games.hasNextPage} loading={games.isFetchingNextPage} onLoadMore={() => games.fetchNextPage()} />
            </>
          )}
        </div>
      </TabPanel>

      <TabPanel idPrefix="search" value="users" active={tab === "users"}>
        {!q ? (
          <EmptyState title="Search for creators" description="Type a username in the search bar." emoji="🔍" />
        ) : creators.isLoading ? (
          <RowSkeleton />
        ) : creators.isError ? (
          <ErrorState onRetry={() => creators.refetch()} />
        ) : userItems.length === 0 ? (
          <EmptyState title="No creators found" description={`Nobody matched “${q}”.`} emoji="🔍" />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Creator results">
              {userItems.map((u) => (
                <li key={u.id}>
                  <Link href={`/u/${u.username}`} className="flex items-center gap-4 rounded-lg border-2 border-line bg-surface p-4 hover:border-primary">
                    <HexAvatar src={u.avatarUrl} name={u.displayName} size="lg" />
                    <span className="min-w-0">
                      <span className="block truncate font-heading text-lg font-semibold">{u.displayName}</span>
                      <span className="block text-sm text-muted">@{u.username}</span>
                      {u.stats && <span className="text-sm text-muted">{plural(u.stats.gamesCount, "game")}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={!!creators.hasNextPage} loading={creators.isFetchingNextPage} onLoadMore={() => creators.fetchNextPage()} />
          </>
        )}
      </TabPanel>
    </div>
  );
}
