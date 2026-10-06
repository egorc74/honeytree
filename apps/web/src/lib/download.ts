import { apiBase } from "./api/client";

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

/**
 * Starts a game download. The API records the download and 302s to a short-lived
 * presigned URL (Content-Disposition: attachment), so navigating the browser to the
 * endpoint downloads the file. Service-worker mocks cannot intercept navigations, so in
 * mock mode we fetch the stub and save the blob instead.
 */
export async function startDownload(gameId: string, filename: string, mediaId?: string): Promise<void> {
  const url = `${apiBase()}/games/${gameId}/download${mediaId ? `?mediaId=${encodeURIComponent(mediaId)}` : ""}`;
  if (!MOCKING) {
    window.location.assign(url);
    return;
  }
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
