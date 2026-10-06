import { ApiError } from "./api/client";
import { uploads } from "./api/endpoints";
import type { MediaKind, MediaStatus, UploadInit } from "./api/types";

export const UPLOAD_LIMITS: Record<string, { max: number; label: string; accept: string }> = {
  build: { max: 2 * 1024 ** 3, label: "2 GB", accept: ".zip,.exe,.dmg,.apk,.appimage,.tar.gz,.tgz" },
  video: { max: 300 * 1024 ** 2, label: "300 MB", accept: "video/*" },
  screenshot: { max: 10 * 1024 ** 2, label: "10 MB", accept: "image/*" },
  cover: { max: 10 * 1024 ** 2, label: "10 MB", accept: "image/*" },
  avatar: { max: 10 * 1024 ** 2, label: "10 MB", accept: "image/*" },
};

/** Client-side pre-check; the API validates again (and checks magic bytes after upload). */
export function validateFile(kind: MediaKind, file: File): string | null {
  const limit = UPLOAD_LIMITS[kind];
  if (file.size > limit.max) return `${file.name} is too large. The limit is ${limit.label}.`;
  if ((kind === "screenshot" || kind === "cover" || kind === "avatar") && !file.type.startsWith("image/")) return `${file.name} is not an image.`;
  if (kind === "video" && !file.type.startsWith("video/")) return `${file.name} is not a video.`;
  if (kind === "build" && !/\.(zip|exe|dmg|apk|appimage|tar\.gz|tgz)$/i.test(file.name)) return "Builds must be .zip, .exe, .dmg, .apk, .AppImage or .tar.gz.";
  return null;
}

export type UploadPhase = "uploading" | MediaStatus;

export interface UploadProgress {
  phase: UploadPhase;
  /** 0–1 while uploading */
  fraction: number;
  mediaId?: string;
  reason?: string;
}

/** Direct-to-storage upload with progress. XHR is used because fetch cannot report upload progress. */
function postToStorage(init: UploadInit, file: File, onProgress: (f: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    for (const [k, v] of Object.entries(init.fields)) form.append(k, v);
    form.append("file", file); // must be the last field for S3 presigned POST
    xhr.open("POST", init.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      rej(new DOMException("Aborted", "AbortError"));
    });
  });

/**
 * Whole pipeline: request a presigned URL → upload with progress → mark complete →
 * poll status (scanning → processing → ready / rejected).
 */
export async function uploadMedia(opts: {
  gameId: string | null; // null = avatar
  kind: MediaKind;
  file: File;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ mediaId: string; status: MediaStatus; reason?: string }> {
  const { gameId, kind, file, onProgress, signal } = opts;
  const report = (p: UploadProgress) => onProgress?.(p);
  const body = { kind, filename: file.name, size: file.size, mime: file.type || "application/octet-stream" };

  report({ phase: "uploading", fraction: 0 });
  const init = gameId ? await uploads.init(gameId, body) : await uploads.initAvatar(body);
  await postToStorage(init, file, (f) => report({ phase: "uploading", fraction: f, mediaId: init.mediaId }), signal);

  let status = await uploads.complete(init.uploadId);
  report({ phase: status.status, fraction: 1, mediaId: status.mediaId });
  const started = Date.now();
  while (status.status !== "ready" && status.status !== "rejected") {
    if (Date.now() - started > 15 * 60_000) throw new Error("Processing is taking too long. Check back later.");
    await sleep(800, signal);
    status = await uploads.status(init.uploadId);
    report({ phase: status.status, fraction: 1, mediaId: status.mediaId, reason: status.reason });
  }
  return { mediaId: status.mediaId, status: status.status, reason: status.reason };
}

export function uploadErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Upload failed.";
}
