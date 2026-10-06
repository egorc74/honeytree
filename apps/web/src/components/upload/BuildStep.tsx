"use client";

import { useMutation } from "@tanstack/react-query";
import { uploads } from "@/lib/api/endpoints";
import type { GameDetail } from "@/lib/api/types";
import { formatBytes } from "@/lib/format";
import { UPLOAD_LIMITS } from "@/lib/upload";
import { Button } from "../ui";
import { FileDrop } from "./FileDrop";
import { MediaStatusBadge } from "./MediaStatus";
import { PendingList } from "./PendingList";
import type { PendingUpload } from "./useUploads";

export function BuildStep({
  game,
  pending,
  onFiles,
  onDismiss,
  onChanged,
}: {
  game: GameDetail;
  pending: PendingUpload[];
  onFiles: (files: File[]) => void;
  onDismiss: (id: string) => void;
  onChanged: () => void;
}) {
  const remove = useMutation({ mutationFn: (id: string) => uploads.removeMedia(id), onSuccess: onChanged });
  const builds = game.builds;

  return (
    <div className="space-y-5">
      <p className="text-muted">
        Upload your game build (up to {UPLOAD_LIMITS.build.label}). Every build is scanned for malware before players can download it.
      </p>
      <FileDrop
        testId="build-input"
        label="Drop your build here, or click to browse"
        hint=".zip, .exe, .dmg, .apk, .AppImage or .tar.gz"
        accept={UPLOAD_LIMITS.build.accept}
        onFiles={onFiles}
      />
      <PendingList items={pending.filter((p) => p.kind === "build")} onDismiss={onDismiss} />
      {builds.length > 0 && (
        <ul className="space-y-2" aria-label="Uploaded builds">
          {builds.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-raised p-3" data-testid="build-item">
              <div className="min-w-0">
                <p className="truncate font-medium">{b.originalName}</p>
                <p className="text-sm text-muted">{formatBytes(b.sizeBytes)}</p>
              </div>
              <div className="flex items-center gap-2">
                <MediaStatusBadge status={b.status} />
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(b.id)} aria-label={`Remove ${b.originalName}`}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
