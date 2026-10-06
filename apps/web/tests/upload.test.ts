import { describe, expect, it } from "vitest";
import { validateFile } from "@/lib/upload";
import { normalizeTag, validateDetails, emptyDetails } from "@/components/upload/DetailsStep";

const file = (name: string, type: string, size = 100) => new File([new Uint8Array(Math.min(size, 10))], name, { type }) as File & { size: number };
const sized = (f: File, size: number) => Object.defineProperty(f, "size", { value: size });

describe("validateFile (limits from PLAN.md §3.2)", () => {
  it("accepts allowed builds and rejects other extensions", () => {
    expect(validateFile("build", file("game.zip", "application/zip"))).toBeNull();
    expect(validateFile("build", file("game.AppImage", ""))).toBeNull();
    expect(validateFile("build", file("game.tar.gz", "application/gzip"))).toBeNull();
    expect(validateFile("build", file("notes.txt", "text/plain"))).toMatch(/Builds must be/);
  });
  it("enforces size limits per kind", () => {
    expect(validateFile("screenshot", sized(file("a.png", "image/png"), 10 * 1024 ** 2 + 1))).toMatch(/too large/);
    expect(validateFile("video", sized(file("a.mp4", "video/mp4"), 301 * 1024 ** 2))).toMatch(/too large/);
    expect(validateFile("build", sized(file("a.zip", "application/zip"), 2 * 1024 ** 3 + 1))).toMatch(/too large/);
    expect(validateFile("build", sized(file("a.zip", "application/zip"), 2 * 1024 ** 3))).toBeNull();
  });
  it("checks the media type for images and videos", () => {
    expect(validateFile("cover", file("a.txt", "text/plain"))).toMatch(/not an image/);
    expect(validateFile("video", file("a.png", "image/png"))).toMatch(/not a video/);
  });
});

describe("details form", () => {
  it("normalises tags", () => {
    expect(normalizeTag("  #Pixel Art! ")).toBe("pixel-art");
    expect(normalizeTag("A")).toBe("a");
  });
  it("validates required fields", () => {
    const errors = validateDetails(emptyDetails);
    expect(Object.keys(errors).sort()).toEqual(["platforms", "shortDescription", "title"]);
    expect(validateDetails({ ...emptyDetails, title: "ab", shortDescription: "x", platforms: ["web"] }).title).toMatch(/at least 3/);
    expect(validateDetails({ ...emptyDetails, title: "Bee Quest", shortDescription: "x", platforms: ["web"] })).toEqual({});
  });
});
