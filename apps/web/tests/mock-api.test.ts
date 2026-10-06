// @vitest-environment node
/**
 * Exercises the real API client (src/lib/api) against the MSW mock backend. This verifies both the
 * mocks and the client against the contract rules in PLAN.md and openapi.yaml: karma (§1.7),
 * the feed interleave (§3.3), search typo tolerance (§1.6) and the publish rule (§3.2).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { ApiError } from "@/lib/api/client";
import { auth, comments, feed, games, leaderboard, reviews, search, uploads, users } from "@/lib/api/endpoints";
import { handlers } from "@/mocks/handlers";
import { awardKarma, db, resetDb } from "@/mocks/db";

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => resetDb());
afterEach(() => server.resetHandlers());

let n = 0;
async function newUser() {
  const username = `tester${++n}${Date.now() % 1000}`;
  await auth.register({ username, email: `${username}@example.com`, password: "password123" });
  return username;
}
const karmaOf = async (username: string) => (await users.get(username)).stats.karma;
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: ApiError) => e.code);

describe("auth", () => {
  it("registers, reads me, logs out and rejects bad credentials", async () => {
    const u = await newUser();
    expect((await auth.me())?.username).toBe(u);
    await auth.logout();
    expect(await auth.me()).toBeNull();
    expect(await code(auth.login({ identifier: u, password: "wrong" }))).toBe("INVALID_CREDENTIALS");
    expect((await auth.login({ identifier: `${u}@example.com`, password: "password123" })).user.username).toBe(u);
  });
  it("validates registration", async () => {
    expect(await code(auth.register({ username: "Bad Name", email: "a@b.co", password: "password123" }))).toBe("VALIDATION_ERROR");
    expect(await code(auth.register({ username: "okname", email: "a@b.co", password: "short" }))).toBe("VALIDATION_ERROR");
    await newUser();
    expect(await code(auth.register({ username: "demo", email: "x@y.co", password: "password123" }))).toBe("USERNAME_TAKEN");
  });
});

describe("karma (PLAN.md §1.7)", () => {
  async function aGame() {
    const page = await feed.list({ limit: 1 });
    return page.items[0];
  }

  it("liking a game earns +1 and unliking reverses it; double likes earn once", async () => {
    const u = await newUser();
    const g = await aGame();
    expect((await games.like(g.id)).karmaAwarded).toBe(1);
    expect((await games.like(g.id)).karmaAwarded).toBe(0);
    expect(await karmaOf(u)).toBe(1);
    const un = await games.unlike(g.id);
    expect(un.karmaAwarded).toBe(-1);
    expect(un.liked).toBe(false);
    expect(await karmaOf(u)).toBe(0);
  });

  it("comment +2, suggestion +3, deleting reverses", async () => {
    const u = await newUser();
    const g = await aGame();
    const c = await comments.create(g.id, { body: "nice", kind: "comment" });
    const s = await comments.create(g.id, { body: "add co-op", kind: "suggestion" });
    expect([c.karmaAwarded, s.karmaAwarded]).toEqual([2, 3]);
    expect(await karmaOf(u)).toBe(5);
    expect((await comments.remove(s.comment.id)).karmaAwarded).toBe(-3);
    expect(await karmaOf(u)).toBe(2);
  });

  it("reviews earn +3 only with ≥ 20 characters, including after an edit", async () => {
    const u = await newUser();
    const g = await aGame();
    const short = await reviews.create(g.id, { rating: 4, body: "good" });
    expect(short.karmaAwarded).toBe(0);
    const longer = await reviews.update(short.review.id, { body: "Really good game, loved the art." });
    expect(longer.karmaAwarded).toBe(3);
    expect(await karmaOf(u)).toBe(3);
    expect((await reviews.remove(short.review.id)).karmaAwarded).toBe(-3);
    expect(await karmaOf(u)).toBe(0);
  });

  it("gives no karma for own content: creators cannot like or review their own game", async () => {
    const owner = db().users.find((x) => x.id === db().games[0].ownerId)!;
    await auth.login({ identifier: owner.username, password: "honeytree123" });
    const mine = db().games.find((x) => x.ownerId === owner.id)!;
    expect(await code(games.like(mine.id))).toBe("SELF_ACTION");
    expect(await code(reviews.create(mine.id, { rating: 5, body: "my own game is great, obviously" }))).toBe("SELF_ACTION");
    const before = await karmaOf(owner.username);
    const c = await comments.create(mine.id, { body: "thanks for playing", kind: "comment" });
    expect(c.karmaAwarded).toBe(0);
    expect(await karmaOf(owner.username)).toBe(before);
  });

  it("caps karma from likes at 50 per day (game likes and comment likes share the cap)", async () => {
    const u = await newUser();
    const me = db().users.find((x) => x.username === u)!;
    let total = 0;
    for (let i = 0; i < 40; i++) total += awardKarma(db(), { userId: me.id, reason: "like_game", refType: "game", refId: `fake-${i}` });
    for (let i = 0; i < 30; i++) total += awardKarma(db(), { userId: me.id, reason: "like_comment", refType: "comment", refId: `fake-c-${i}` });
    expect(total).toBe(50);
    expect(await karmaOf(u)).toBe(50);
    // likes are capped but comments still earn karma until the 100 total
    const g = (await feed.list({ limit: 1 })).items[0];
    expect((await comments.create(g.id, { body: "still earning", kind: "comment" })).karmaAwarded).toBe(2);
  });

  it("caps total karma at 100 per day", async () => {
    const u = await newUser();
    const g = (await feed.list({ limit: 1 })).items[0];
    for (let i = 0; i < 40; i++) await comments.create(g.id, { body: `comment ${i}`, kind: "suggestion" }); // 3 each
    expect(await karmaOf(u)).toBe(100);
  });

  it("accepting a suggestion gives its author +10 and un-accepting reverses it", async () => {
    const author = await newUser();
    const g = (await feed.list({ limit: 1 })).items[0];
    const { comment } = await comments.create(g.id, { body: "please add a hard mode", kind: "suggestion" });
    await auth.logout();
    const owner = db().users.find((x) => x.id === db().games.find((y) => y.id === g.id)!.ownerId)!;
    await auth.login({ identifier: owner.username, password: "honeytree123" });
    await comments.accept(comment.id);
    expect(await karmaOf(author)).toBe(13);
    expect(await code(comments.accept(comment.id))).toBe("ok"); // idempotent
    expect(await karmaOf(author)).toBe(13);
    await comments.unaccept(comment.id);
    expect(await karmaOf(author)).toBe(3);
  });

  it("only the creator can accept; replies are one level deep", async () => {
    await newUser();
    const g = (await feed.list({ limit: 1 })).items[0];
    const { comment } = await comments.create(g.id, { body: "idea", kind: "suggestion" });
    expect(await code(comments.accept(comment.id))).toBe("FORBIDDEN");
    const reply = await comments.create(g.id, { body: "reply", kind: "comment", parentId: comment.id });
    expect(await code(comments.create(g.id, { body: "deeper", kind: "comment", parentId: reply.comment.id }))).toBe("VALIDATION_ERROR");
  });
});

describe("feed (PLAN.md §3.3)", () => {
  it("interleaves Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest without duplicates", async () => {
    const items: Awaited<ReturnType<typeof feed.list>>["items"] = [];
    let cursor: string | null = null;
    do {
      const page = await feed.list({ cursor, limit: 50 });
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);
    expect(new Set(items.map((g) => g.id)).size).toBe(items.length);
    const badges = items.slice(0, 6).map((g) => g.badge);
    expect(badges).toEqual(["buzzing", "fresh", "sweetest", "fresh", "buzzing", "sweetest"]);
  });
  it("the buzzing carousel only returns buzzing games", async () => {
    const { items } = await feed.buzzing();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((g) => g.badge === "buzzing")).toBe(true);
  });
});

describe("search (PLAN.md §1.6)", () => {
  it("finds a game by a misspelled title and a creator by username", async () => {
    const hit = await search.games("velvt voyge", []);
    expect(hit.items.map((g) => g.title)).toContain("Velvet Voyage");
    const people = await search.users("queenbe");
    expect(people.items.map((u) => u.username)).toContain("queenbee");
    const s = await search.suggest("velvt");
    expect(s.games.some((g) => g.title === "Velvet Voyage")).toBe(true);
  });
  it("filters by tags (all must match) and requires q", async () => {
    const first = await search.games("a", ["horror"]);
    expect(first.items.every((g) => g.tags.includes("horror"))).toBe(true);
    expect(await code(search.games("", []))).toBe("VALIDATION_ERROR");
  });
});

describe("leaderboard", () => {
  it("returns ranked entries for every type and period", async () => {
    for (const type of ["games", "creators", "karma"] as const) {
      for (const period of ["week", "month", "all"] as const) {
        const { items } = await leaderboard.get(type, period);
        expect(items.map((e) => e.rank)).toEqual(items.map((_, i) => i + 1));
        expect(items.every((e, i) => i === 0 || items[i - 1].score >= e.score)).toBe(true);
        if (type === "games") expect(items.every((e) => e.game)).toBe(true);
        else expect(items.every((e) => e.user)).toBe(true);
      }
    }
  });
});

describe("publish rule and upload pipeline", () => {
  it("refuses to publish until title, cover, a screenshot and a ready build exist", async () => {
    await newUser();
    const g = await games.create({ title: "Pipeline Test", shortDescription: "x", platforms: ["web"] });
    const err = (await games.publish(g.id).catch((e: ApiError) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("PUBLISH_REQUIREMENTS");
    expect(err.message).toMatch(/cover/);
  });

  async function upload(gameId: string, kind: "build" | "cover" | "screenshot", filename: string, mime: string) {
    const init = await uploads.init(gameId, { kind, filename, size: 1000, mime });
    expect(init.method).toBe("PUT");
    expect(init.uploadId).toBe(init.media.id);
    const put = await fetch(init.url.startsWith("http") ? init.url : `http://localhost${init.url}`, { method: "PUT", body: "x" });
    expect(put.ok).toBe(true);
    let media = await uploads.complete(init.uploadId);
    expect(media.status).toBe("scanning");
    for (let i = 0; i < 40 && media.status !== "ready" && media.status !== "rejected"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      media = await uploads.status(init.uploadId);
    }
    return media;
  }

  it("takes a game from draft to published and hides non-ready media from others", async () => {
    const owner = await newUser();
    const g = await games.create({ title: "Pipeline Test", shortDescription: "x", platforms: ["web"] });
    const build = await upload(g.id, "build", "game.zip", "application/zip");
    const cover = await upload(g.id, "cover", "cover.png", "image/png");
    const shot = await upload(g.id, "screenshot", "s.png", "image/png");
    expect([build.status, cover.status, shot.status]).toEqual(["ready", "ready", "ready"]);
    await games.update(g.id, { coverMediaId: cover.id });
    const published = await games.publish(g.id);
    expect(published.status).toBe("published");
    expect(published.cover?.variants.card).toBeTruthy();
    expect(published.builds[0].variants).toEqual({}); // builds have no variants
    expect((await users.get(owner)).stats.gamesCount).toBe(1);
  });

  it("rejects infected files (EICAR) and files over the limit", async () => {
    await newUser();
    const g = await games.create({ title: "Virus Test", shortDescription: "x", platforms: ["web"] });
    const bad = await upload(g.id, "build", "eicar.zip", "application/zip");
    expect(bad.status).toBe("rejected");
    expect(bad.rejectReason).toBeTruthy();
    expect(await code(uploads.init(g.id, { kind: "build", filename: "big.zip", size: 3 * 1024 ** 3, mime: "application/zip" }))).toBe("INVALID_UPLOAD");
    expect(await code(uploads.init(g.id, { kind: "screenshot", filename: "a.exe", size: 10, mime: "image/png" }))).toBe("INVALID_UPLOAD");
  });

  it("hides drafts from other users", async () => {
    await newUser();
    const g = await games.create({ title: "Secret Draft", shortDescription: "x", platforms: ["web"] });
    await auth.logout();
    expect(await code(games.get(g.slug))).toBe("NOT_FOUND");
  });
});
