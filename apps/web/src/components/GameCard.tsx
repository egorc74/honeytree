/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useToggleGameLike } from "@/hooks/useLikes";
import type { Game } from "@/lib/api/types";
import { compactNumber, formatRating } from "@/lib/format";
import { Badge, FeedBadge, HexAvatar, LikeButton, cx } from "./ui";

export function GameCard({ game, className, priority = false }: { game: Game; className?: string; priority?: boolean }) {
  const toggleLike = useToggleGameLike();

  return (
    <article
      data-testid="game-card"
      className={cx(
        "group relative flex flex-col overflow-hidden rounded-lg border-2 border-line bg-surface transition-shadow hover:shadow-comb focus-within:shadow-comb",
        className,
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-raised">
        {game.cover ? (
          <img
            src={game.cover.card ?? game.cover.full}
            alt={`${game.title} cover art`}
            width={640}
            height={360}
            loading={priority ? "eager" : "lazy"}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
          />
        ) : (
          <div className="grid h-full place-items-center text-4xl" aria-hidden>
            🍯
          </div>
        )}
        {game.badge && <FeedBadge kind={game.badge} className="absolute left-3 top-3" />}
        {game.status !== "published" && (
          <Badge tone="danger" className="absolute right-3 top-3 capitalize">
            {game.status}
          </Badge>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-heading text-lg font-semibold leading-tight">
          {/* The stretched link makes the whole card clickable while the like button stays independent */}
          <Link href={`/games/${game.slug}`} className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-offset-4">
            {game.title}
          </Link>
        </h3>

        <Link
          href={`/u/${game.owner.username}`}
          className="relative z-10 inline-flex w-fit items-center gap-2 text-sm text-muted hover:text-fg hover:underline"
        >
          <HexAvatar src={game.owner.avatarUrl} name={game.owner.displayName} size="xs" ring={false} />
          {game.owner.displayName}
        </Link>

        {game.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {game.tags.slice(0, 3).map((t) => (
              <li key={t}>
                <Link href={`/search?q=${encodeURIComponent(t)}&tags=${encodeURIComponent(t)}`} className="relative z-10">
                  <Badge className="hover:border-primary">#{t}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <dl className="flex items-center gap-3 text-sm text-muted">
            <div className="flex items-center gap-1" title="Average rating">
              <dt className="sr-only">Rating</dt>
              <dd>
                <span aria-hidden>★ </span>
                <span className="tabular-nums">{formatRating(game.ratingAvg)}</span>
              </dd>
            </div>
            <div className="flex items-center gap-1" title="Downloads">
              <dt className="sr-only">Downloads</dt>
              <dd>
                <span aria-hidden>⬇ </span>
                <span className="tabular-nums">{compactNumber(game.downloadsCount)}</span>
              </dd>
            </div>
          </dl>
          <span className="relative z-10">
            <LikeButton size="sm" label="game" liked={game.likedByMe} count={game.likesCount} onToggle={() => toggleLike(game)} />
          </span>
        </div>
      </div>
    </article>
  );
}
