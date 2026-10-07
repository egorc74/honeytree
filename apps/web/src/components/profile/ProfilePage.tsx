"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { LoadMore } from "@/hooks/useInfinite";
import { ApiError } from "@/lib/api/client";
import { games as gamesApi, users } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { ActivityItem, Game, UserProfile } from "@/lib/api/types";
import { compactNumber, formatDate, formatRating, plural, timeAgo } from "@/lib/format";
import { useAuth } from "../AuthProvider";
import { GameCard } from "../GameCard";
import {
  Button, ButtonLink, EmptyState, ErrorState, GameGridSkeleton, HexAvatar, Modal, RowSkeleton, Skeleton, StarRating, TabPanel, Tabs, useToast,
} from "../ui";
import { EditProfileModal } from "./EditProfileModal";
import { StatTile } from "./StatTile";

type Tab = "games" | "reviews" | "activity";

export function ProfilePage({ username, initial }: { username: string; initial?: UserProfile | null }) {
  const { me } = useAuth();
  const { data: profile, error, isLoading, refetch } = useQuery({
    queryKey: keys.profile(username),
    queryFn: () => users.get(username),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: 0,
  });
  const [tab, setTab] = useState<Tab>("games");
  const [editing, setEditing] = useState(false);

  if (isLoading) return <ProfileSkeleton />;
  if (error instanceof ApiError && error.status === 404)
    return <EmptyState title="Creator not found" description={`Nobody is buzzing under @${username}.`} emoji="🔍" action={<ButtonLink href="/">Back to the feed</ButtonLink>} />;
  if (error || !profile) return <ErrorState message="Could not load this profile." onRetry={() => refetch()} />;

  const isMe = me?.id === profile.id;
  const s = profile.stats;
  const links = profile.links ?? [];

  return (
    <div className="space-y-8" data-testid="profile-page">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <HexAvatar src={profile.avatarUrl} name={profile.displayName} size="xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h1 className="font-heading text-3xl font-semibold">{profile.displayName}</h1>
            <p className="text-muted">
              @{profile.username} · joined {formatDate(profile.createdAt)}
            </p>
          </div>
          {profile.bio && <p className="max-w-2xl whitespace-pre-line">{profile.bio}</p>}
          {links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Links">
              {links.map((l) => (
                <li key={`${l.label}-${l.url}`}>
                  {/^https?:\/\//.test(l.url) ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer nofollow" className="text-link underline">
                      {l.label}
                    </a>
                  ) : (
                    <span className="text-muted">{l.label}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {isMe && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
            <ButtonLink href="/upload">Upload game</ButtonLink>
          </div>
        )}
      </header>

      <section aria-label="Stats" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile testId="stat-likes" icon="🍯" label="Likes received" value={compactNumber(s.likesReceived)} />
        <StatTile testId="stat-games" icon="🎮" label={s.gamesCount === 1 ? "Game" : "Games"} value={s.gamesCount} />
        <StatTile testId="stat-rating" icon="⭐" label="Average rating" value={formatRating(s.ratingAvg)} sub={plural(s.ratingCount, "review")} />
        <StatTile testId="stat-karma" icon="🐝" label="Karma" value={compactNumber(s.karma)} />
      </section>

      <div>
        <Tabs
          idPrefix="profile"
          label="Profile sections"
          value={tab}
          onChange={setTab}
          items={[
            { value: "games", label: "Games", count: s.gamesCount },
            { value: "reviews", label: "Reviews written" },
            { value: "activity", label: "Activity" },
          ]}
        />
        <TabPanel idPrefix="profile" value="games" active={tab === "games"}>
          <GamesTab username={profile.username} isMe={isMe} />
        </TabPanel>
        <TabPanel idPrefix="profile" value="reviews" active={tab === "reviews"}>
          <ReviewsTab username={profile.username} />
        </TabPanel>
        <TabPanel idPrefix="profile" value="activity" active={tab === "activity"}>
          <ActivityTab username={profile.username} />
        </TabPanel>
      </div>

      {isMe && me && editing && <EditProfileModal user={me} bio={profile.bio} links={profile.links ?? []} open onClose={() => setEditing(false)} />}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading profile">
      <div className="flex items-center gap-5">
        <Skeleton className="h-28 w-28 rounded-full" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

function GamesTab({ username, isMe }: { username: string; isMe: boolean }) {
  const list = useInfiniteQuery({
    queryKey: keys.userGames(username),
    queryFn: ({ pageParam }) => users.games(username, { cursor: pageParam, status: isMe ? "all" : "published" }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  if (list.isLoading) return <GameGridSkeleton count={3} />;
  if (list.isError) return <ErrorState onRetry={() => list.refetch()} />;
  if (!items.length)
    return (
      <EmptyState
        title={isMe ? "You haven’t published a game yet" : "No games yet"}
        description={isMe ? "Upload your first game and let the hive find it." : undefined}
        action={isMe ? <ButtonLink href="/upload">Upload a game</ButtonLink> : undefined}
        emoji="🎮"
      />
    );
  return (
    <>
      <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Games">
        {items.map((g) => (
          <li key={g.id} className="flex flex-col gap-2">
            <GameCard game={g} className="flex-1" />
            {isMe && <ManageGame game={g} />}
          </li>
        ))}
      </ul>
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
    </>
  );
}

/** Edit / unpublish / delete for the owner. */
function ManageGame({ game }: { game: Game }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => void qc.invalidateQueries();

  const toggle = useMutation({
    mutationFn: () => (game.status === "published" ? gamesApi.unpublish(game.id) : gamesApi.publish(game.id)),
    onSuccess: () => {
      toast(game.status === "published" ? "Game unpublished." : "Game published 🐝", "success");
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not update the game.", "error"),
  });
  const remove = useMutation({
    mutationFn: () => gamesApi.remove(game.id),
    onSuccess: () => {
      toast("Game deleted.");
      setConfirm(false);
      refresh();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not delete the game.", "error"),
  });

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={`Manage ${game.title}`}>
      <ButtonLink href={`/upload/${game.slug}`} variant="secondary" size="sm">
        Edit
      </ButtonLink>
      <Button variant="secondary" size="sm" onClick={() => toggle.mutate()} loading={toggle.isPending}>
        {game.status === "published" ? "Unpublish" : "Publish"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} className="text-danger">
        Delete
      </Button>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete this game?" description={`“${game.title}” and its files, reviews and comments will be removed. This can’t be undone.`}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
            Delete game
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ReviewsTab({ username }: { username: string }) {
  const list = useInfiniteQuery({
    queryKey: keys.userReviews(username),
    queryFn: ({ pageParam }) => users.reviews(username, { cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (l) => l.nextCursor,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  if (list.isLoading) return <RowSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => list.refetch()} />;
  if (!items.length) return <EmptyState title="No reviews written" emoji="⭐" />;
  return (
    <>
      <ul className="space-y-3" aria-label="Reviews written">
        {items.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-raised p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/games/${r.game.slug}`} className="font-heading font-semibold hover:underline">
                {r.game.title}
              </Link>
              <StarRating value={r.rating} showValue={false} />
              <span className="text-sm text-muted">{timeAgo(r.createdAt)}</span>
            </div>
            {r.body && <p className="mt-1 whitespace-pre-line break-words">{r.body}</p>}
          </li>
        ))}
      </ul>
      <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onLoadMore={() => list.fetchNextPage()} />
    </>
  );
}

const ACTIVITY_TEXT: Record<ActivityItem["type"], string> = {
  like: "liked",
  comment: "commented on",
  suggestion: "suggested an idea for",
  review: "reviewed",
  published: "published",
};
const ACTIVITY_ICON: Record<ActivityItem["type"], string> = { like: "🍯", comment: "💬", suggestion: "💡", review: "⭐", published: "🚀" };

function ActivityTab({ username }: { username: string }) {
  const { data: items, isLoading, isError, refetch } = useQuery({ queryKey: keys.userActivity(username), queryFn: () => users.activity(username) });
  if (isLoading) return <RowSkeleton />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (!items?.length) return <EmptyState title="No activity yet" emoji="🐝" />;
  return (
    <ol className="space-y-3" aria-label="Recent activity">
      {items.map((a, i) => (
        <li key={`${a.type}-${a.createdAt}-${i}`} className="flex gap-3 rounded-lg border border-line bg-raised p-3">
          <span aria-hidden className="text-xl">
            {ACTIVITY_ICON[a.type]}
          </span>
          <div className="min-w-0">
            <p>
              {ACTIVITY_TEXT[a.type]}{" "}
              <Link href={`/games/${a.game.slug}`} className="font-medium text-link underline">
                {a.game.title}
              </Link>
              {a.type === "review" && a.rating ? <StarRating value={a.rating} showValue={false} size={14} className="ml-2 align-middle" /> : null}
              <span className="ml-2 text-sm text-muted">{timeAgo(a.createdAt)}</span>
            </p>
            {a.excerpt && <p className="truncate text-sm text-muted">“{a.excerpt}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
