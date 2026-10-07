"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LoadMore } from "@/hooks/useInfinite";
import { feed } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import { GameCard } from "../GameCard";
import { EmptyState, ErrorState, GameGridSkeleton, HexDivider } from "../ui";
import { BuzzingCarousel } from "./BuzzingCarousel";

export function Feed() {
  const buzzing = useQuery({ queryKey: keys.buzzing, queryFn: feed.buzzing });
  const list = useInfiniteQuery({
    queryKey: keys.feed,
    queryFn: ({ pageParam }) => feed.list({ cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const games = list.data?.pages.flatMap((p) => p.items) ?? [];
  const buzzingItems = buzzing.data?.items ?? [];

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Feed</h1>
      <section aria-labelledby="buzzing-heading" className="space-y-3">
        <h2 id="buzzing-heading" className="font-heading text-2xl font-semibold">
          🐝 Buzzing now
        </h2>
        {buzzing.isLoading ? (
          <GameGridSkeleton count={3} />
        ) : buzzing.isError ? (
          <ErrorState message="Could not load the buzzing games." onRetry={() => buzzing.refetch()} />
        ) : buzzingItems.length ? (
          <BuzzingCarousel games={buzzingItems} />
        ) : (
          <p className="text-muted">Nothing is buzzing yet. Be the first to get the hive humming!</p>
        )}
      </section>

      <HexDivider />

      <section aria-labelledby="feed-heading" className="space-y-4">
        <h2 id="feed-heading" className="font-heading text-2xl font-semibold">
          Fresh from the hive
        </h2>
        {list.isLoading ? (
          <GameGridSkeleton count={6} />
        ) : list.isError ? (
          <ErrorState message="Could not load the feed." onRetry={() => list.refetch()} />
        ) : games.length === 0 ? (
          <EmptyState title="No games yet" description="Games appear here as soon as creators publish them." />
        ) : (
          <>
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Games">
              {games.map((g, i) => (
                <li key={g.id}>
                  <GameCard game={g} priority={i < 3} />
                </li>
              ))}
            </ul>
            <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
          </>
        )}
      </section>
    </div>
  );
}
