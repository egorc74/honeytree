/* eslint-disable @next/next/no-img-element */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { uploads } from "@/lib/api/endpoints";
import { keys } from "@/lib/api/keys";
import type { GameDetail, Media } from "@/lib/api/types";
import { UPLOAD_LIMITS } from "@/lib/upload";
import { Button, cx } from "../ui";
import { FileDrop } from "./FileDrop";
import { MediaStatusBadge } from "./MediaStatus";
import { PendingList } from "./PendingList";
import type { PendingUpload } from "./useUploads";

export function MediaStep({
  game,
  pending,
  onFiles,
  onDismiss,
  onChanged,
}: {
  game: GameDetail;
  pending: PendingUpload[];
  onFiles: (kind: "cover" | "screenshot" | "video", files: File[]) => void;
  onDismiss: (id: string) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const remove = useMutation({ mutationFn: (id: string) => uploads.removeMedia(id), onSuccess: onChanged });
  const [dragging, setDragging] = useState<number | null>(null);
  const shots = game.screenshots;

  const reorder = useMutation({
    mutationFn: (order: string[]) => uploads.reorder(game.id, order),
    onMutate: (order) => {
      // Optimistic: reflect the new order immediately.
      qc.setQueryData<GameDetail>(keys.game(game.slug), (g) =>
        g ? { ...g, screenshots: order.map((id, i) => ({ ...g.screenshots.find((s) => s.id === id)!, sortOrder: i })) } : g,
      );
    },
    onSettled: onChanged,
  });

  function move(from: number, to: number) {
    if (to < 0 || to >= shots.length || from === to) return;
    const ids = shots.map((s) => s.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder.mutate(ids);
  }

  const cover = game.cover;
  const video = game.video;

  return (
    <div className="space-y-10">
      {/* Cover */}
      <section aria-labelledby="cover-h" className="space-y-3">
        <h3 id="cover-h" className="font-heading text-xl font-semibold">
          Cover image <span className="text-sm font-normal text-danger">required</span>
        </h3>
        <p className="text-sm text-muted">16:9 works best (for example 1600×900). Up to {UPLOAD_LIMITS.cover.label}.</p>
        <div className="grid items-start gap-4 sm:grid-cols-[16rem_1fr]">
          <Thumb item={cover} alt="Cover preview" empty="No cover yet" />
          <div className="space-y-3">
            <FileDrop testId="cover-input" label={cover ? "Replace cover" : "Add a cover"} hint="PNG, JPG or WebP" accept={UPLOAD_LIMITS.cover.accept} onFiles={(f) => onFiles("cover", f)} />
            <PendingList items={pending.filter((p) => p.kind === "cover")} onDismiss={onDismiss} />
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section aria-labelledby="shots-h" className="space-y-3">
        <h3 id="shots-h" className="font-heading text-xl font-semibold">
          Screenshots <span className="text-sm font-normal text-danger">at least 1 required</span>
        </h3>
        <p className="text-sm text-muted">Drag to reorder, or use the arrow buttons. The first screenshot is shown first on your game page.</p>
        <FileDrop testId="screenshot-input" multiple label="Add screenshots" hint={`PNG, JPG or WebP, up to ${UPLOAD_LIMITS.screenshot.label} each`} accept={UPLOAD_LIMITS.screenshot.accept} onFiles={(f) => onFiles("screenshot", f)} />
        <PendingList items={pending.filter((p) => p.kind === "screenshot")} onDismiss={onDismiss} />
        {shots.length > 0 && (
          <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Screenshots in display order" data-testid="screenshot-list">
            {shots.map((s, i) => (
              <li
                key={s.id}
                draggable
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging !== null) move(dragging, i);
                  setDragging(null);
                }}
                onDragEnd={() => setDragging(null)}
                className={cx("space-y-2 rounded-lg border-2 border-line bg-raised p-2", dragging === i && "opacity-50")}
                data-testid="screenshot-item"
              >
                <Thumb item={s} alt={`Screenshot ${i + 1}`} empty="…" />
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium">#{i + 1}</span>
                  <MediaStatusBadge status={s.status} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" className="px-2" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move screenshot ${i + 1} earlier`}>
                      ←
                    </Button>
                    <Button size="sm" variant="secondary" className="px-2" disabled={i === shots.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move screenshot ${i + 1} later`}>
                      →
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => remove.mutate(s.id)} aria-label={`Remove screenshot ${i + 1}`}>
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Video */}
      <section aria-labelledby="video-h" className="space-y-3">
        <h3 id="video-h" className="font-heading text-xl font-semibold">
          Trailer video <span className="text-sm font-normal text-muted">optional</span>
        </h3>
        <p className="text-sm text-muted">Up to {UPLOAD_LIMITS.video.label}. We convert it to 720p so it plays everywhere.</p>
        {video && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised p-3" data-testid="video-item">
            <span className="truncate font-medium">{video.originalName}</span>
            <span className="flex items-center gap-2">
              <MediaStatusBadge status={video.status} />
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(video.id)}>
                Remove
              </Button>
            </span>
          </div>
        )}
        <FileDrop testId="video-input" label={video ? "Replace trailer" : "Add a trailer"} hint="MP4, MOV or WebM" accept={UPLOAD_LIMITS.video.accept} onFiles={(f) => onFiles("video", f)} />
        <PendingList items={pending.filter((p) => p.kind === "video")} onDismiss={onDismiss} />
      </section>
    </div>
  );
}

function Thumb({ item, alt, empty }: { item: Media | null; alt: string; empty: string }) {
  const src = item?.status === "ready" ? (item.variants.thumb ?? item.variants.card) : undefined;
  return (
    <div className="grid aspect-video w-full place-items-center overflow-hidden rounded-md bg-surface text-sm text-muted">
      {src ? <img src={src} alt={alt} className="h-full w-full object-cover" /> : <span>{item ? item.status : empty}</span>}
    </div>
  );
}
