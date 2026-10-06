import { describe, expect, it } from "vitest";
import { normalizeGame, normalizeMedia } from "@/lib/api/endpoints";

describe("media normalisation", () => {
  it("accepts plain URL variants (openapi.yaml)", () => {
    const m = normalizeMedia({ id: "1", kind: "video", status: "ready", url: "https://x/v", originalName: "t.mp4", sizeBytes: 1, sortOrder: 0, variants: { mp4: "https://x/v.mp4", poster: "https://x/p.webp" } });
    expect(m?.variants).toMatchObject({ mp4: "https://x/v.mp4", poster: "https://x/p.webp" });
  });

  it("accepts { url } variants and mp4_720p (Agent 3's note)", () => {
    const m = normalizeMedia({
      id: "1", kind: "video", status: "ready", url: null, originalName: "t.mp4", sizeBytes: 1, sortOrder: 0,
      variants: { mp4_720p: { url: "https://x/v.mp4" }, poster: { url: "https://x/p.webp" }, thumb: { url: "https://x/t.webp" } },
    });
    expect(m?.variants).toMatchObject({ mp4: "https://x/v.mp4", poster: "https://x/p.webp", thumb: "https://x/t.webp" });
  });

  it("returns null for missing media and tolerates missing variants", () => {
    expect(normalizeMedia(null)).toBeNull();
    expect(normalizeMedia({ id: "1", kind: "build", status: "ready", url: null, originalName: "a.zip", sizeBytes: 1, sortOrder: 0 })?.variants).toEqual({});
  });

  it("sorts screenshots by sortOrder", () => {
    const shot = (id: string, sortOrder: number) => ({ id, kind: "screenshot" as const, status: "ready" as const, url: null, originalName: id, sizeBytes: 1, sortOrder, variants: {} });
    const g = normalizeGame({ screenshots: [shot("b", 1), shot("a", 0)], cover: null, video: null, builds: [] } as any);
    expect(g.screenshots.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
