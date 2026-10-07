import { describe, expect, it } from "vitest";
import { compactNumber, formatBytes, formatRating, plural, timeAgo } from "@/lib/format";

describe("format", () => {
  it("compacts numbers", () => {
    expect(compactNumber(7)).toBe("7");
    expect(compactNumber(1200)).toBe("1.2k");
    expect(compactNumber(12_000)).toBe("12k");
    expect(compactNumber(2_500_000)).toBe("2.5M");
  });
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(231 * 1024 ** 2)).toBe("231 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });
  it("formats ratings and plurals", () => {
    expect(formatRating(null)).toBe("–");
    expect(formatRating(4)).toBe("4.0");
    expect(plural(1, "review")).toBe("1 review");
    expect(plural(3, "review")).toBe("3 reviews");
  });
  it("formats relative time", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    expect(timeAgo("2026-10-06T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-10-06T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-10-05T12:00:00Z", now)).toBe("yesterday");
  });
});
