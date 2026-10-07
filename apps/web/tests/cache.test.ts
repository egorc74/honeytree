import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { mapDeep, patchComment, patchGame } from "@/lib/cache";

const game = (id: string, likesCount = 1) => ({ id, slug: id, likesCount, likedByMe: false });

describe("mapDeep", () => {
  it("patches matching objects at any depth and keeps untouched branches identical", () => {
    const untouched = { items: [game("b")] };
    const data = { pages: [{ items: [game("a"), game("c")] }, untouched] };
    const next = mapDeep(data, (o) => o.id === "a", () => ({ likesCount: 9 })) as typeof data;
    expect(next.pages[0].items[0].likesCount).toBe(9);
    expect(next.pages[1]).toBe(untouched);
    expect(next.pages[0].items[1]).toBe(data.pages[0].items[1]);
  });

  it("returns the same reference when nothing matches", () => {
    const data = { items: [game("a")] };
    expect(mapDeep(data, () => false, () => ({}))).toBe(data);
  });
});

describe("optimistic patches", () => {
  it("updates a game in the feed, the game page and a profile list at once", () => {
    const qc = new QueryClient();
    qc.setQueryData(["feed"], { pages: [{ items: [game("g1", 3)] }] });
    qc.setQueryData(["game", "g1"], { ...game("g1", 3), description: "x" });
    qc.setQueryData(["user-games", "bob"], { pages: [{ items: [game("g1", 3), game("g2", 5)] }] });
    qc.setQueryData(["me"], { id: "g1", slug: "me", likesCount: 0 }); // must be left alone

    patchGame(qc, "g1", (g) => ({ likedByMe: true, likesCount: g.likesCount + 1 }));

    expect((qc.getQueryData(["feed"]) as any).pages[0].items[0]).toMatchObject({ likedByMe: true, likesCount: 4 });
    expect(qc.getQueryData(["game", "g1"])).toMatchObject({ likedByMe: true, likesCount: 4 });
    expect((qc.getQueryData(["user-games", "bob"]) as any).pages[0].items[1].likesCount).toBe(5);
    expect(qc.getQueryData(["me"])).toMatchObject({ likesCount: 0 });
  });

  it("patches comments inside thread replies", () => {
    const qc = new QueryClient();
    const reply = { id: "r1", gameId: "g", kind: "comment", likesCount: 0, likedByMe: false };
    qc.setQueryData(["comments", "g", "all", "top"], { pages: [{ items: [{ id: "c1", gameId: "g", kind: "comment", likesCount: 0, likedByMe: false, replies: [reply] }] }] });
    patchComment(qc, "r1", () => ({ likesCount: 1, likedByMe: true }));
    expect((qc.getQueryData(["comments", "g", "all", "top"]) as any).pages[0].items[0].replies[0]).toMatchObject({ likesCount: 1, likedByMe: true });
  });
});
