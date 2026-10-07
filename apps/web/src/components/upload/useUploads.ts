"use client";

import { useCallback, useState } from "react";
import { games } from "@/lib/api/endpoints";
import type { MediaKind } from "@/lib/api/types";
import { uploadErrorMessage, uploadMedia, validateFile, type UploadPhase } from "@/lib/upload";

export interface PendingUpload {
  id: string;
  kind: MediaKind;
  name: string;
  phase: UploadPhase;
  fraction: number;
  error?: string;
}

let counter = 0;

/**
 * Tracks in-flight uploads for the wizard. Finished uploads disappear from `pending`
 * (they now show up on the game itself); failed/rejected ones stay until dismissed.
 */
export function useUploads(gameId: string | undefined, onSettled: () => void) {
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const patch = (id: string, p: Partial<PendingUpload>) => setPending((l) => l.map((u) => (u.id === id ? { ...u, ...p } : u)));

  const start = useCallback(
    (kind: MediaKind, files: File[]) => {
      if (!gameId) return;
      for (const file of files) {
        const id = `up-${++counter}`;
        const problem = validateFile(kind, file);
        if (problem) {
          setPending((l) => [...l, { id, kind, name: file.name, phase: "rejected", fraction: 0, error: problem }]);
          continue;
        }
        setPending((l) => [...l, { id, kind, name: file.name, phase: "uploading", fraction: 0 }]);
        uploadMedia({
          gameId,
          kind,
          file,
          onProgress: (p) => patch(id, { phase: p.phase, fraction: p.fraction }),
        })
          .then(async (res) => {
            if (res.status === "rejected") {
              patch(id, { phase: "rejected", error: res.reason ?? "The file was rejected." });
            } else {
              // The cover is only attached to the game once it is `ready` (a new cover/video replaces the old one).
              if (kind === "cover") await games.update(gameId, { coverMediaId: res.mediaId });
              setPending((l) => l.filter((u) => u.id !== id));
            }
            onSettled();
          })
          .catch((e) => {
            patch(id, { phase: "rejected", error: uploadErrorMessage(e) });
            onSettled();
          });
      }
    },
    [gameId, onSettled],
  );

  const dismiss = useCallback((id: string) => setPending((l) => l.filter((u) => u.id !== id)), []);
  return { pending, start, dismiss };
}
