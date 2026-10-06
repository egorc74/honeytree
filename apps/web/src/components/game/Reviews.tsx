"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { LoadMore } from "@/hooks/useInfinite";
import { reviews as reviewsApi } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { GameDetail, RatingSummary, Review } from "@/lib/api/types";
import { plural, timeAgo } from "@/lib/format";
import { useAuth } from "../AuthProvider";
import { Button, EmptyState, HexAvatar, RowSkeleton, StarRating, StarRatingInput, TextArea, useToast } from "../ui";
import { ReportButton } from "./ReportButton";

const MIN_KARMA_LENGTH = 20;

export function Reviews({ game }: { game: GameDetail }) {
  const qc = useQueryClient();
  const { me, requireAuth } = useAuth();
  const { toast, karma } = useToast();
  const mine = game.myReview;
  const isOwner = me?.id === game.owner.id;

  const [rating, setRating] = useState(mine?.rating ?? 0);
  const [body, setBody] = useState(mine?.body ?? "");
  const [error, setError] = useState<string | null>(null);

  // Keep the form in sync once the game (and therefore my review) loads or changes.
  useEffect(() => {
    setRating(mine?.rating ?? 0);
    setBody(mine?.body ?? "");
  }, [mine?.id, mine?.updatedAt]);

  const list = useInfiniteQuery({
    queryKey: keys.reviews(game.id),
    queryFn: ({ pageParam }) => reviewsApi.list(game.id, { cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const summary = list.data?.pages[0]?.summary;

  function refresh() {
    void qc.invalidateQueries({ queryKey: keys.reviews(game.id) });
    void qc.invalidateQueries({ queryKey: keys.game(game.slug) });
    void qc.invalidateQueries({ queryKey: ["profile"] });
    void qc.invalidateQueries({ queryKey: ["user-reviews"] });
  }

  const save = useMutation({
    mutationFn: () => (mine ? reviewsApi.update(mine.id, { rating, body }) : reviewsApi.create(game.id, { rating, body })),
    onSuccess: (res) => {
      setError(null);
      toast(mine ? "Review updated." : "Thanks for your review!", "success");
      karma(res.karmaAwarded);
      refresh();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save your review."),
  });

  const remove = useMutation({
    mutationFn: () => reviewsApi.remove(mine!.id),
    onSuccess: () => {
      setRating(0);
      setBody("");
      toast("Review deleted.");
      refresh();
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Pick a star rating first.");
    requireAuth(() => save.mutate());
  }

  const short = body.trim().length < MIN_KARMA_LENGTH;

  return (
    <section aria-labelledby="reviews-heading" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="reviews-heading" className="font-heading text-2xl font-semibold">
          Reviews
        </h2>
        <StarRating value={game.ratingAvg} count={game.reviewsCount} size={20} />
      </div>

      {summary && summary.ratingCount > 0 && <RatingBars summary={summary} />}

      {isOwner ? (
        <p className="rounded-md bg-surface px-4 py-3 text-muted">You can’t review your own game. Players will leave theirs here.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-lg border-2 border-line bg-surface p-4" aria-label={mine ? "Edit your review" : "Write a review"}>
          <h3 className="font-heading text-lg font-semibold">{mine ? "Your review" : "Rate this game"}</h3>
          <StarRatingInput value={rating} onChange={setRating} label="Your rating" />
          <TextArea
            label="Your thoughts"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            placeholder="What did you love? What could be better?"
            hint={short ? `Write at least ${MIN_KARMA_LENGTH} characters to earn karma 🍯` : undefined}
            error={error}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={save.isPending}>
              {mine ? "Update review" : "Post review"}
            </Button>
            {mine && (
              <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
                Delete
              </Button>
            )}
          </div>
        </form>
      )}

      {list.isLoading ? (
        <RowSkeleton />
      ) : items.length === 0 ? (
        <EmptyState title="No reviews yet" description="Be the first to tell others what you think." emoji="⭐" />
      ) : (
        <ul className="space-y-4" aria-label="Reviews">
          {items.map((r) => (
            <ReviewItem key={r.id} review={r} />
          ))}
        </ul>
      )}
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} label="More reviews" />
    </section>
  );
}

function ReviewItem({ review }: { review: Review }) {
  const edited = review.updatedAt !== review.createdAt;
  return (
    <li className="flex gap-3 rounded-lg border border-line bg-raised p-4" data-testid="review">
      <HexAvatar src={review.user.avatarUrl} name={review.user.displayName} size="md" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/u/${review.user.username}`} className="font-heading font-semibold hover:underline">
            {review.user.displayName}
          </Link>
          <StarRating value={review.rating} showValue={false} size={16} />
          <span className="text-sm text-muted">
            {timeAgo(review.createdAt)}
            {edited && " (edited)"}
          </span>
        </div>
        {review.body && <p className="whitespace-pre-line break-words">{review.body}</p>}
        <ReportButton targetType="review" targetId={review.id} />
      </div>
    </li>
  );
}

/** Star distribution from the API's rating summary. */
function RatingBars({ summary }: { summary: RatingSummary }) {
  const max = Math.max(1, ...Object.values(summary.distribution));
  return (
    <div className="space-y-1 rounded-lg border border-line bg-raised p-4" aria-label="Rating distribution" role="group">
      {[5, 4, 3, 2, 1].map((stars) => {
        const n = summary.distribution[String(stars)] ?? 0;
        return (
          <div key={stars} className="flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0 tabular-nums">{stars} stars</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-pill bg-surface" aria-hidden>
              <div className="h-full rounded-pill bg-primary" style={{ width: `${(n / max) * 100}%` }} />
            </div>
            <span className="w-8 text-right tabular-nums text-muted">
              <span className="sr-only">{plural(n, "review")}</span>
              <span aria-hidden>{n}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
