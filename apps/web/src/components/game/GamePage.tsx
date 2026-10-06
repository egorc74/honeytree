/* eslint-disable @next/next/no-img-element */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useToggleGameLike } from "@/hooks/useLikes";
import { ApiError } from "@/lib/api/client";
import { games } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { GameDetail } from "@/lib/api/types";
import { startDownload } from "@/lib/download";
import { PLATFORM_LABEL, compactNumber, formatBytes, formatDate } from "@/lib/format";
import { useAuth } from "../AuthProvider";
import { Markdown } from "../Markdown";
import { Badge, Button, ButtonLink, EmptyState, ErrorState, FeedBadge, HexAvatar, HexDivider, LikeButton, Skeleton, StarRating, useToast } from "../ui";
import { Comments } from "./Comments";
import { Gallery } from "./Gallery";
import { ReportButton } from "./ReportButton";
import { Reviews } from "./Reviews";
import { VideoPlayer } from "./VideoPlayer";

export function GamePage({ slug, initial }: { slug: string; initial?: GameDetail | null }) {
  const { data: game, error, isLoading, refetch } = useQuery({
    queryKey: keys.game(slug),
    queryFn: () => games.get(slug),
    // Server-rendered copy is anonymous (no likedByMe/myReview): paint it for SEO, then refetch right away.
    initialData: initial ?? undefined,
    initialDataUpdatedAt: 0,
  });

  if (isLoading || (!game && !error)) return <GameSkeleton />;
  if (error instanceof ApiError && error.status === 404)
    return <EmptyState title="Game not found" description="It may have been unpublished or removed by its creator." emoji="🔍" action={<ButtonLink href="/">Back to the feed</ButtonLink>} />;
  if (error || !game) return <ErrorState message="Could not load this game." onRetry={() => refetch()} />;

  return <GameContent game={game} />;
}

function GameSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading game">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="aspect-video w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function GameContent({ game }: { game: GameDetail }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const { toast } = useToast();
  const toggleLike = useToggleGameLike();
  const isOwner = me?.id === game.owner.id;
  const readyBuilds = game.builds.filter((b) => b.status === "ready");
  const build = readyBuilds[0] ?? game.builds[0];
  const [downloading, setDownloading] = useState(false);

  const status = useMutation({
    mutationFn: (action: "publish" | "unpublish") => (action === "publish" ? games.publish(game.id) : games.unpublish(game.id)),
    onSuccess: () => {
      void qc.invalidateQueries();
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Could not update the game.", "error"),
  });

  async function download(mediaId?: string) {
    setDownloading(true);
    try {
      await startDownload(game.id, `${game.slug}.txt`, mediaId);
      toast("Your download is starting… 🍯", "success");
      setTimeout(() => void qc.invalidateQueries({ queryKey: keys.game(game.slug) }), 1200);
    } catch {
      toast("Could not start the download.", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <article className="space-y-8" data-testid="game-page">
      {game.status !== "published" && (
        <div role="status" className="rounded-lg bg-danger-bg px-4 py-3 text-danger">
          This game is <strong>{game.status}</strong>
          {isOwner ? ": only you can see it." : "."}{" "}
          {isOwner && game.status === "draft" && (
            <Link href={`/upload/${game.slug}`} className="font-medium underline">
              Finish and publish it
            </Link>
          )}
        </div>
      )}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {game.badge && <FeedBadge kind={game.badge} />}
          {game.platforms.map((p) => (
            <Badge key={p}>{PLATFORM_LABEL[p] ?? p}</Badge>
          ))}
          <Badge>v{game.version}</Badge>
        </div>
        <h1 className="font-heading text-4xl font-semibold text-balance">{game.title}</h1>
        <p className="max-w-3xl text-lg text-muted">{game.shortDescription}</p>
        <Link href={`/u/${game.owner.username}`} className="inline-flex items-center gap-2 font-medium hover:underline">
          <HexAvatar src={game.owner.avatarUrl} name={game.owner.displayName} size="sm" />
          by {game.owner.displayName}
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {game.video ? (
            <VideoPlayer video={game.video} title={game.title} />
          ) : game.cover?.variants.full || game.coverUrl ? (
            <img src={game.cover?.variants.full ?? game.coverUrl ?? undefined} alt={`${game.title} cover art`} className="aspect-video w-full rounded-lg border-2 border-line object-cover" />
          ) : null}
          <Gallery screenshots={game.screenshots} title={game.title} />

          <section aria-labelledby="about-heading" className="space-y-3">
            <h2 id="about-heading" className="font-heading text-2xl font-semibold">
              About this game
            </h2>
            <Markdown source={game.description || game.shortDescription} />
            {game.tags.length > 0 && (
              <ul className="flex flex-wrap gap-2 pt-2" aria-label="Tags">
                {game.tags.map((t) => (
                  <li key={t}>
                    <Link href={`/search?q=${encodeURIComponent(t)}&tags=${encodeURIComponent(t)}`}>
                      <Badge className="px-3 py-1 text-sm hover:border-primary">#{t}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="Download and details">
          <div className="space-y-4 rounded-lg border-2 border-line bg-surface p-5">
            <Button size="lg" className="w-full" onClick={() => download()} loading={downloading} disabled={!build || game.status !== "published"} data-testid="download-button">
              ⬇ Download{build ? ` (${formatBytes(build.sizeBytes)})` : ""}
            </Button>
            {readyBuilds.length > 1 && (
              <ul className="space-y-1 text-sm" aria-label="All builds">
                {readyBuilds.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{b.originalName}</span>
                    <button type="button" className="shrink-0 font-medium text-link underline" onClick={() => download(b.id)} aria-label={`Download ${b.originalName}`}>
                      {formatBytes(b.sizeBytes)} ⬇
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between gap-3">
              <LikeButton size="lg" label="game" liked={game.likedByMe} count={game.likesCount} onToggle={() => toggleLike(game)} disabled={isOwner} title={isOwner ? "You can’t like your own game" : undefined} />
              <StarRating value={game.ratingAvg} count={game.reviewsCount} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Downloads</dt>
              <dd className="text-right font-medium tabular-nums" data-testid="downloads-count">
                {compactNumber(game.downloadsCount)}
              </dd>
              <dt className="text-muted">Version</dt>
              <dd className="text-right font-medium">{game.version}</dd>
              <dt className="text-muted">Platforms</dt>
              <dd className="text-right font-medium">{game.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ") || "–"}</dd>
              {build && (
                <>
                  <dt className="text-muted">File size</dt>
                  <dd className="text-right font-medium">{formatBytes(build.sizeBytes)}</dd>
                </>
              )}
              {game.publishedAt && (
                <>
                  <dt className="text-muted">Published</dt>
                  <dd className="text-right font-medium">{formatDate(game.publishedAt)}</dd>
                </>
              )}
            </dl>
            <div className="border-t border-line pt-3">
              <ReportButton targetType="game" targetId={game.id} label="🚩 Report this game" />
            </div>
          </div>

          {isOwner && (
            <div className="space-y-2 rounded-lg border-2 border-line bg-surface p-5">
              <h2 className="font-heading font-semibold">Manage</h2>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/upload/${game.slug}`} variant="secondary" size="sm">
                  Edit
                </ButtonLink>
                {game.status === "published" ? (
                  <Button variant="secondary" size="sm" onClick={() => status.mutate("unpublish")} loading={status.isPending}>
                    Unpublish
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => status.mutate("publish")} loading={status.isPending}>
                    Publish
                  </Button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <HexDivider />
      <Reviews game={game} />
      <HexDivider />
      <Comments game={game} />
    </article>
  );
}
