/**
 * MSW handlers implementing PLAN.md §3.2 against the in-memory db.
 * Paths use a `*` host prefix so they match both the browser (relative) and
 * Node/SSR (absolute) request URLs.
 */
import { delay, http, HttpResponse } from "msw";
import type { ActivityItem, CommentKind, GameInput, LeaderboardEntry, MediaStatus, Platform } from "@/lib/api/types";
import {
  awardKarma, currentUser, db, engagement, feedLists, gameStats, karmaTotal, mixedFeed, MIN_REVIEW_KARMA_LENGTH,
  nextId, periodStart, persist, resetDb, reverseKarma, slugify, toComment, toGame, toGameDetail, toProfile,
  toReview, toUser, userSummary, type DbGame, type DbMedia, type DbState,
} from "./db";
import { placeholderAvatar } from "./placeholder";


const BASE = "*/api/v1";
const DAY = 86_400_000;

function err(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}
const unauthorized = () => err(401, "UNAUTHORIZED", "Please log in to do that.");
const forbidden = (m = "You are not allowed to do that.") => err(403, "FORBIDDEN", m);
const notFound = (what = "Not found") => err(404, "NOT_FOUND", what);

function paginate<T>(items: T[], request: Request, defaultLimit = 20) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || defaultLimit, 50);
  const start = Number(url.searchParams.get("cursor")) || 0;
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
}

function findGame(s: DbState, key: string): DbGame | undefined {
  return s.games.find((g) => g.id === key || g.slug === key);
}

/** Drafts/unpublished/removed games are only visible to their owner (and admins). */
function visibleTo(g: DbGame, meId: string | null, s: DbState) {
  if (g.status === "published") return true;
  const me = meId ? s.users.find((u) => u.id === meId) : null;
  return !!me && (me.id === g.ownerId || me.role === "admin") && g.status !== "removed";
}

/* ---------------- similarity ("typo tolerant" search, a stand-in for pg_trgm) ---------------- */
function trigrams(s: string) {
  const p = `  ${s.toLowerCase()} `;
  const out = new Set<string>();
  for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  return out;
}
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  ta.forEach((t) => tb.has(t) && inter++);
  return inter / (ta.size + tb.size - inter || 1);
}
function textScore(q: string, ...fields: string[]): number {
  const ql = q.toLowerCase();
  let best = 0;
  for (const f of fields) {
    const fl = f.toLowerCase();
    if (fl.includes(ql)) best = Math.max(best, 1 + (fl.startsWith(ql) ? 0.5 : 0));
    best = Math.max(best, similarity(ql, fl));
    // word-level so a typo in one title word still matches
    for (const w of fl.split(/[^a-z0-9]+/)) if (w.length > 2) best = Math.max(best, similarity(ql, w) * 1.1);
  }
  return best;
}
const MATCH_THRESHOLD = 0.3;

/* ---------------- upload pipeline simulation ---------------- */
function pipelineStatus(m: DbMedia): MediaStatus {
  if (m.status !== "scanning" && m.status !== "processing") return m.status;
  const t = Date.now() - (m.pipelineStartedAt ?? 0);
  const rejected = /eicar|virus|malware/i.test(m.originalName);
  if (t < 700) return "scanning";
  if (rejected) return "rejected";
  if (t < 1400) return "processing";
  return "ready";
}
function settle(m: DbMedia) {
  const next = pipelineStatus(m);
  if (next !== m.status) m.status = next;
  return m;
}

const LIMITS: Record<string, { max: number; mimes: RegExp; label: string }> = {
  build: { max: 2 * 1024 ** 3, mimes: /^(application\/(zip|x-zip-compressed|x-msdownload|x-apple-diskimage|vnd\.android\.package-archive|gzip|x-gzip|x-tar|x-iso9660-image|octet-stream|x-executable)|application\/x-)/, label: "2 GB" },
  video: { max: 300 * 1024 ** 2, mimes: /^video\//, label: "300 MB" },
  screenshot: { max: 10 * 1024 ** 2, mimes: /^image\//, label: "10 MB" },
  cover: { max: 10 * 1024 ** 2, mimes: /^image\//, label: "10 MB" },
  avatar: { max: 10 * 1024 ** 2, mimes: /^image\//, label: "10 MB" },
};

function gamesSnapshot(s: DbState, meId: string | null, ids: DbGame[]) {
  return ids.map((g) => toGame(s, g, meId));
}

export const handlers = [
  /* ------------------------------- auth ------------------------------- */
  http.post(`${BASE}/auth/register`, async ({ request }) => {
    await delay(80);
    const s = db();
    const body = (await request.json()) as { username?: string; email?: string; password?: string };
    const username = (body.username ?? "").trim();
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return err(422, "VALIDATION_ERROR", "Username must be 3–24 letters, numbers or underscores.");
    if (!/^\S+@\S+\.\S+$/.test(body.email ?? "")) return err(422, "VALIDATION_ERROR", "Enter a valid email address.");
    if ((body.password ?? "").length < 8) return err(422, "VALIDATION_ERROR", "Password must be at least 8 characters.");
    if (s.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return err(409, "USERNAME_TAKEN", "That username is taken.");
    if (s.users.some((u) => u.email.toLowerCase() === body.email!.toLowerCase())) return err(409, "EMAIL_TAKEN", "That email is already registered.");
    const user = {
      id: nextId("u"), username, email: body.email!, password: body.password!, displayName: username, bio: "", links: {}, role: "user" as const,
      avatarUrl: placeholderAvatar(username, username), createdAt: new Date().toISOString(),
    };
    s.users.push(user);
    s.sessionUserId = user.id;
    persist();
    return HttpResponse.json({ user: toUser(user, true) }, { status: 201 });
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    await delay(80);
    const s = db();
    const body = (await request.json()) as { email?: string; password?: string };
    const id = (body.email ?? "").toLowerCase();
    const user = s.users.find((u) => u.email.toLowerCase() === id || u.username.toLowerCase() === id);
    if (!user || user.password !== body.password) return err(401, "INVALID_CREDENTIALS", "Wrong email or password.");
    s.sessionUserId = user.id;
    persist();
    return HttpResponse.json({ user: toUser(user, true) });
  }),

  http.post(`${BASE}/auth/logout`, () => {
    db().sessionUserId = null;
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/auth/me`, () => {
    const me = currentUser(db());
    return me ? HttpResponse.json({ user: toUser(me, true) }) : unauthorized();
  }),

  /* ------------------------------- users ------------------------------- */
  http.patch(`${BASE}/users/me`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as { displayName?: string; bio?: string; links?: Record<string, string>; avatarMediaId?: string };
    if (body.displayName !== undefined) {
      if (!body.displayName.trim() || body.displayName.length > 40) return err(422, "VALIDATION_ERROR", "Display name must be 1–40 characters.");
      me.displayName = body.displayName.trim();
    }
    if (body.bio !== undefined) {
      if (body.bio.length > 500) return err(422, "VALIDATION_ERROR", "Bio can be at most 500 characters.");
      me.bio = body.bio;
    }
    if (body.links) me.links = Object.fromEntries(Object.entries(body.links).filter(([, v]) => v));
    if (body.avatarMediaId) {
      me.avatarUrl = placeholderAvatar(body.avatarMediaId + me.username, me.displayName);
    }
    persist();
    return HttpResponse.json(toUser(me, true));
  }),

  http.get(`${BASE}/users/:username`, async ({ params }) => {
    await delay(60);
    const s = db();
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    return HttpResponse.json(toProfile(s, u));
  }),

  http.get(`${BASE}/users/:username/games`, ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    const own = me?.id === u.id;
    const list = s.games
      .filter((g) => g.ownerId === u.id && (own ? g.status !== "removed" : g.status === "published"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(list, request, 12);
    return HttpResponse.json({ ...page, items: gamesSnapshot(s, me?.id ?? null, page.items) });
  }),

  http.get(`${BASE}/users/:username/reviews`, ({ params, request }) => {
    const s = db();
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    const list = s.reviews.filter((r) => r.userId === u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(list, request, 10);
    return HttpResponse.json({
      ...page,
      items: page.items.map((r) => {
        const g = s.games.find((x) => x.id === r.gameId)!;
        const tg = toGame(s, g, null);
        return { ...toReview(s, r), game: { id: tg.id, slug: tg.slug, title: tg.title, cover: tg.cover } };
      }),
    });
  }),

  http.get(`${BASE}/users/:username/activity`, ({ params, request }) => {
    const s = db();
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    const title = (gameId: string) => {
      const g = s.games.find((x) => x.id === gameId);
      return g ? { id: g.id, slug: g.slug, title: g.title } : null;
    };
    const items: ActivityItem[] = [];
    for (const l of s.gameLikes.filter((x) => x.userId === u.id)) items.push({ id: `a_gl_${l.gameId}`, type: "like_game", createdAt: l.createdAt, game: title(l.gameId) });
    for (const r of s.reviews.filter((x) => x.userId === u.id)) items.push({ id: `a_r_${r.id}`, type: "review", createdAt: r.createdAt, game: title(r.gameId), excerpt: r.body });
    for (const c of s.comments.filter((x) => x.userId === u.id && !x.deletedAt))
      items.push({ id: `a_c_${c.id}`, type: c.kind, createdAt: c.createdAt, game: title(c.gameId), excerpt: c.body });
    for (const g of s.games.filter((x) => x.ownerId === u.id && x.status === "published" && x.publishedAt))
      items.push({ id: `a_p_${g.id}`, type: "publish", createdAt: g.publishedAt!, game: { id: g.id, slug: g.slug, title: g.title } });
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json(paginate(items, request, 15));
  }),

  /* ------------------------------- games ------------------------------- */
  http.post(`${BASE}/games`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as GameInput;
    const bad = validateGameInput(body, true);
    if (bad) return bad;
    const id = nextId("g");
    let slug = slugify(body.title ?? "untitled");
    while (s.games.some((g) => g.slug === slug)) slug = `${slug}-${Math.floor(Math.random() * 900 + 100)}`;
    const g: DbGame = {
      id, slug, ownerId: me.id, title: body.title ?? "", shortDescription: body.shortDescription ?? "", description: body.description ?? "",
      tags: body.tags ?? [], platforms: body.platforms ?? [], version: body.version ?? "1.0.0", status: "draft", coverMediaId: null, media: [],
      baseDownloads: 0, rising: false, publishedAt: null, createdAt: new Date().toISOString(),
    };
    s.games.push(g);
    persist();
    return HttpResponse.json(toGameDetail(s, g, me.id), { status: 201 });
  }),

  http.get(`${BASE}/games/:key`, async ({ params }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    const g = findGame(s, String(params.key));
    if (!g || !visibleTo(g, me?.id ?? null, s)) return notFound("Game not found");
    g.media.forEach(settle);
    return HttpResponse.json(toGameDetail(s, g, me?.id ?? null));
  }),

  http.patch(`${BASE}/games/:id`, async ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    if (g.ownerId !== me.id && me.role !== "admin") return forbidden();
    const body = (await request.json()) as GameInput;
    const bad = validateGameInput(body, false);
    if (bad) return bad;
    Object.assign(g, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    persist();
    return HttpResponse.json(toGameDetail(s, g, me.id));
  }),

  http.post(`${BASE}/games/:id/publish`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    if (g.ownerId !== me.id) return forbidden();
    g.media.forEach(settle);
    const missing: string[] = [];
    if (!g.title.trim()) missing.push("a title");
    if (!g.media.some((m) => m.id === g.coverMediaId && m.status === "ready")) missing.push("a cover");
    if (!g.media.some((m) => m.kind === "screenshot" && m.status === "ready")) missing.push("at least one screenshot");
    if (!g.media.some((m) => m.kind === "build" && m.status === "ready")) missing.push("a build that finished processing");
    if (missing.length) return err(422, "PUBLISH_REQUIREMENTS", `To publish you still need ${missing.join(", ")}.`);
    g.status = "published";
    g.publishedAt ??= new Date().toISOString();
    persist();
    return HttpResponse.json(toGameDetail(s, g, me.id));
  }),

  http.post(`${BASE}/games/:id/unpublish`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    if (g.ownerId !== me.id && me.role !== "admin") return forbidden();
    g.status = "unpublished";
    persist();
    return HttpResponse.json(toGameDetail(s, g, me.id));
  }),

  http.delete(`${BASE}/games/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    if (g.ownerId !== me.id && me.role !== "admin") return forbidden();
    s.games = s.games.filter((x) => x.id !== g.id);
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/games/:id/download`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    const g = findGame(s, String(params.id));
    if (!g || g.status !== "published") return notFound("Game not found");
    // Repeat downloads by the same user within 24h count once.
    const who = me?.id ?? "anon";
    const recent = s.downloads.some((d) => d.gameId === g.id && d.who === who && Date.now() - new Date(d.createdAt).getTime() < DAY);
    if (!recent) s.downloads.push({ gameId: g.id, who, createdAt: new Date().toISOString() });
    persist();
    return new HttpResponse(`Honeytree mock build for ${g.title}\n`, {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${g.slug}.txt"` },
    });
  }),

  /* ------------------------------- likes ------------------------------- */
  http.put(`${BASE}/games/:id/like`, async ({ params }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g || g.status !== "published") return notFound("Game not found");
    let karmaAwarded = 0;
    if (!s.gameLikes.some((l) => l.gameId === g.id && l.userId === me.id)) {
      s.gameLikes.push({ userId: me.id, gameId: g.id, createdAt: new Date().toISOString() });
      if (g.ownerId !== me.id) karmaAwarded = awardKarma(s, { userId: me.id, reason: "like_game", refType: "game", refId: g.id });
    }
    persist();
    return HttpResponse.json({ liked: true, likesCount: gameStats(s, g).likesCount, karmaAwarded });
  }),

  http.delete(`${BASE}/games/:id/like`, async ({ params }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    const had = s.gameLikes.length;
    s.gameLikes = s.gameLikes.filter((l) => !(l.gameId === g.id && l.userId === me.id));
    if (had !== s.gameLikes.length) reverseKarma(s, me.id, "game", g.id, "like_game");
    persist();
    return HttpResponse.json({ liked: false, likesCount: gameStats(s, g).likesCount, karmaAwarded: 0 });
  }),

  /* ------------------------------ reviews ------------------------------ */
  http.get(`${BASE}/games/:id/reviews`, ({ params, request }) => {
    const s = db();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    const list = s.reviews.filter((r) => r.gameId === g.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(list, request, 10);
    return HttpResponse.json({ ...page, items: page.items.map((r) => toReview(s, r)) });
  }),

  http.post(`${BASE}/games/:id/reviews`, async ({ params, request }) => {
    await delay(80);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g || g.status !== "published") return notFound("Game not found");
    if (g.ownerId === me.id) return forbidden("You cannot review your own game.");
    if (s.reviews.some((r) => r.gameId === g.id && r.userId === me.id)) return err(409, "REVIEW_EXISTS", "You already reviewed this game. Edit your review instead.");
    const body = (await request.json()) as { rating?: number; body?: string };
    if (!Number.isInteger(body.rating) || body.rating! < 1 || body.rating! > 5) return err(422, "VALIDATION_ERROR", "Rating must be 1 to 5 stars.");
    if ((body.body ?? "").length > 4000) return err(422, "VALIDATION_ERROR", "Review is too long.");
    const now = new Date().toISOString();
    const r = { id: nextId("r"), gameId: g.id, userId: me.id, rating: body.rating!, body: (body.body ?? "").trim(), createdAt: now, updatedAt: now };
    s.reviews.push(r);
    const karmaAwarded = r.body.length >= MIN_REVIEW_KARMA_LENGTH ? awardKarma(s, { userId: me.id, reason: "review", refType: "review", refId: r.id }) : 0;
    persist();
    return HttpResponse.json({ ...toReview(s, r), karmaAwarded }, { status: 201 });
  }),

  http.patch(`${BASE}/reviews/:id`, async ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const r = s.reviews.find((x) => x.id === params.id);
    if (!r) return notFound("Review not found");
    if (r.userId !== me.id) return forbidden();
    const body = (await request.json()) as { rating?: number; body?: string };
    if (body.rating !== undefined) {
      if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) return err(422, "VALIDATION_ERROR", "Rating must be 1 to 5 stars.");
      r.rating = body.rating;
    }
    if (body.body !== undefined) r.body = body.body.trim();
    r.updatedAt = new Date().toISOString();
    persist();
    return HttpResponse.json(toReview(s, r));
  }),

  http.delete(`${BASE}/reviews/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const r = s.reviews.find((x) => x.id === params.id);
    if (!r) return notFound("Review not found");
    if (r.userId !== me.id && me.role !== "admin") return forbidden();
    s.reviews = s.reviews.filter((x) => x.id !== r.id);
    reverseKarma(s, r.userId, "review", r.id, "review");
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  /* ------------------------------ comments ------------------------------ */
  http.get(`${BASE}/games/:id/comments`, ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    const all = s.comments.filter((c) => c.gameId === g.id);
    // Soft-deleted comments stay as a placeholder only if they still have replies.
    const tops = all
      .filter((c) => !c.parentId && (!c.deletedAt || all.some((r) => r.parentId === c.id && !r.deletedAt)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(tops, request, 10);
    return HttpResponse.json({
      ...page,
      items: page.items.map((c) => ({
        ...toComment(s, c, me?.id ?? null),
        replies: all.filter((r) => r.parentId === c.id && !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => toComment(s, r, me?.id ?? null)),
      })),
    });
  }),

  http.post(`${BASE}/games/:id/comments`, async ({ params, request }) => {
    await delay(80);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g || g.status !== "published") return notFound("Game not found");
    const body = (await request.json()) as { body?: string; kind?: CommentKind; parentId?: string };
    const text = (body.body ?? "").trim();
    if (!text || text.length > 2000) return err(422, "VALIDATION_ERROR", "Comment must be 1–2000 characters.");
    const kind: CommentKind = body.kind === "suggestion" ? "suggestion" : "comment";
    if (body.parentId) {
      const parent = s.comments.find((c) => c.id === body.parentId && c.gameId === g.id);
      if (!parent) return notFound("Parent comment not found");
      if (parent.parentId) return err(422, "VALIDATION_ERROR", "Replies can only go one level deep.");
      if (kind === "suggestion") return err(422, "VALIDATION_ERROR", "A reply cannot be a suggestion.");
    }
    const c = {
      id: nextId("c"), gameId: g.id, parentId: body.parentId ?? null, userId: me.id, kind, body: text, acceptedAt: null, deletedAt: null,
      createdAt: new Date().toISOString(),
    };
    s.comments.push(c);
    const karmaAwarded = g.ownerId === me.id ? 0 : awardKarma(s, { userId: me.id, reason: kind, refType: "comment", refId: c.id });
    persist();
    return HttpResponse.json({ ...toComment(s, c, me.id), replies: [], karmaAwarded }, { status: 201 });
  }),

  http.delete(`${BASE}/comments/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id);
    if (!c) return notFound("Comment not found");
    if (c.userId !== me.id && me.role !== "admin") return forbidden();
    c.deletedAt = new Date().toISOString();
    reverseKarma(s, c.userId, "comment", c.id, c.kind);
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.put(`${BASE}/comments/:id/like`, async ({ params }) => {
    await delay(40);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id && !x.deletedAt);
    if (!c) return notFound("Comment not found");
    let karmaAwarded = 0;
    if (!s.commentLikes.some((l) => l.commentId === c.id && l.userId === me.id)) {
      s.commentLikes.push({ userId: me.id, commentId: c.id, createdAt: new Date().toISOString() });
      if (c.userId !== me.id) karmaAwarded = awardKarma(s, { userId: me.id, reason: "like_comment", refType: "comment", refId: c.id });
    }
    persist();
    return HttpResponse.json({ liked: true, likesCount: s.commentLikes.filter((l) => l.commentId === c.id).length, karmaAwarded });
  }),

  http.delete(`${BASE}/comments/:id/like`, async ({ params }) => {
    await delay(40);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id);
    if (!c) return notFound("Comment not found");
    const had = s.commentLikes.length;
    s.commentLikes = s.commentLikes.filter((l) => !(l.commentId === c.id && l.userId === me.id));
    if (had !== s.commentLikes.length) reverseKarma(s, me.id, "comment", c.id, "like_comment");
    persist();
    return HttpResponse.json({ liked: false, likesCount: s.commentLikes.filter((l) => l.commentId === c.id).length, karmaAwarded: 0 });
  }),

  http.post(`${BASE}/comments/:id/accept`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id && !x.deletedAt);
    if (!c) return notFound("Comment not found");
    const g = s.games.find((x) => x.id === c.gameId)!;
    if (g.ownerId !== me.id) return forbidden("Only the game's creator can accept suggestions.");
    if (c.kind !== "suggestion") return err(422, "VALIDATION_ERROR", "Only suggestions can be accepted.");
    if (!c.acceptedAt) {
      c.acceptedAt = new Date().toISOString();
      if (c.userId !== me.id) awardKarma(s, { userId: c.userId, reason: "suggestion_accepted", refType: "comment", refId: c.id });
    }
    persist();
    return HttpResponse.json(toComment(s, c, me.id));
  }),

  /* ------------------------- feed / leaderboard / search ------------------------- */
  http.get(`${BASE}/feed/buzzing`, async () => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    return HttpResponse.json({ items: feedLists(s).buzzing.slice(0, 12).map((g) => toGame(s, g, me?.id ?? null, "buzzing")) });
  }),

  http.get(`${BASE}/feed`, async ({ request }) => {
    await delay(80);
    const s = db();
    const me = currentUser(s);
    const page = paginate(mixedFeed(s), request, 12);
    return HttpResponse.json({ ...page, items: page.items.map((x) => toGame(s, x.game, me?.id ?? null, x.badge)) });
  }),

  http.get(`${BASE}/leaderboard`, async ({ request }) => {
    await delay(80);
    const s = db();
    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "games";
    const since = periodStart(url.searchParams.get("period"));
    const me = currentUser(s);
    const inPeriod = (t: string) => new Date(t).getTime() >= since;
    let rows: { score: number; game?: DbGame; user?: (typeof s.users)[number] }[] = [];
    if (type === "games") {
      rows = s.games.filter((g) => g.status === "published").map((game) => ({ game, score: s.gameLikes.filter((l) => l.gameId === game.id && inPeriod(l.createdAt)).length }));
    } else if (type === "creators") {
      rows = s.users.map((user) => {
        const ids = new Set(s.games.filter((g) => g.ownerId === user.id && g.status === "published").map((g) => g.id));
        return { user, score: s.gameLikes.filter((l) => ids.has(l.gameId) && inPeriod(l.createdAt)).length };
      });
    } else {
      rows = s.users.map((user) => ({ user, score: karmaTotal(s, user.id, since) }));
    }
    const items: LeaderboardEntry[] = rows
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r, i) => ({ rank: i + 1, score: r.score, ...(r.game ? { game: toGame(s, r.game, me?.id ?? null) } : { user: userSummary(r.user!) }) }));
    return HttpResponse.json({ items });
  }),

  http.get(`${BASE}/search/suggest`, async ({ request }) => {
    await delay(40);
    const s = db();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (q.length < 2) return HttpResponse.json({ games: [], users: [] });
    const games = s.games
      .filter((g) => g.status === "published")
      .map((g) => ({ g, sc: textScore(q, g.title) }))
      .filter((x) => x.sc >= MATCH_THRESHOLD)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 5)
      .map(({ g }) => {
        const tg = toGame(s, g, null);
        return { id: tg.id, slug: tg.slug, title: tg.title, cover: tg.cover, tags: tg.tags };
      });
    const users = s.users
      .map((u) => ({ u, sc: textScore(q, u.username, u.displayName) }))
      .filter((x) => x.sc >= MATCH_THRESHOLD)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 4)
      .map((x) => userSummary(x.u));
    return HttpResponse.json({ games, users });
  }),

  http.get(`${BASE}/search`, async ({ request }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const type = url.searchParams.get("type") ?? "games";
    const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
    if (type === "users") {
      const rows = s.users
        .map((u) => ({ u, sc: q ? textScore(q, u.username, u.displayName) : 0.5 }))
        .filter((x) => x.sc >= MATCH_THRESHOLD)
        .sort((a, b) => b.sc - a.sc)
        .map(({ u }) => ({ ...userSummary(u), bio: u.bio, gamesCount: s.games.filter((g) => g.ownerId === u.id && g.status === "published").length }));
      return HttpResponse.json(paginate(rows, request, 12));
    }
    const matching = s.games
      .filter((g) => g.status === "published")
      .map((g) => ({ g, sc: q ? Math.max(textScore(q, g.title), g.tags.some((t) => t === q.toLowerCase()) ? 1 : 0, textScore(q, g.shortDescription) * 0.6) : 0.5 }))
      .filter((x) => x.sc >= MATCH_THRESHOLD);
    const facetCounts = new Map<string, number>();
    matching.forEach((x) => x.g.tags.forEach((t) => facetCounts.set(t, (facetCounts.get(t) ?? 0) + 1)));
    const filtered = matching.filter((x) => tags.every((t) => x.g.tags.includes(t))).sort((a, b) => b.sc - a.sc);
    const page = paginate(filtered, request, 12);
    return HttpResponse.json({
      ...page,
      items: page.items.map((x) => toGame(s, x.g, me?.id ?? null)),
      facets: { tags: [...facetCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) },
    });
  }),

  http.post(`${BASE}/reports`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as { targetType?: string; targetId?: string; reason?: string };
    if (!body.targetType || !body.targetId || !(body.reason ?? "").trim()) return err(422, "VALIDATION_ERROR", "Tell us what is wrong.");
    const id = nextId("rep");
    s.reports.push({ id, reporterId: me.id, targetType: body.targetType, targetId: body.targetId, reason: body.reason!, createdAt: new Date().toISOString() });
    persist();
    return HttpResponse.json({ id }, { status: 201 });
  }),

  /* ------------------------------- uploads ------------------------------- */
  http.post(`${BASE}/games/:id/uploads`, async ({ params, request }) => uploadInit(String(params.id), request)),
  // Avatars are not game-bound. Not in the plan's contract: see docs/requests/agent2-avatar-upload.md
  http.post(`${BASE}/users/me/uploads`, async ({ request }) => uploadInit(null, request)),

  http.post("*/mock-storage/:uploadId", () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/uploads/:id/complete`, ({ params }) => {
    const s = db();
    const up = s.uploads[String(params.id)];
    if (!up) return notFound("Upload not found");
    const m = findMedia(s, up);
    if (!m) return notFound("Upload not found");
    m.status = "scanning";
    m.pipelineStartedAt = Date.now();
    persist();
    return HttpResponse.json({ uploadId: String(params.id), mediaId: m.id, status: m.status });
  }),

  http.get(`${BASE}/uploads/:id`, ({ params }) => {
    const s = db();
    const up = s.uploads[String(params.id)];
    const m = up && findMedia(s, up);
    if (!up || !m) return notFound("Upload not found");
    settle(m);
    persist();
    return HttpResponse.json({
      uploadId: String(params.id), mediaId: m.id, status: m.status, ...(m.status === "rejected" ? { reason: "Malware detected by the scanner." } : {}),
    });
  }),

  http.delete(`${BASE}/media/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    for (const g of s.games) {
      const i = g.media.findIndex((m) => m.id === params.id);
      if (i >= 0) {
        if (g.ownerId !== me.id) return forbidden();
        if (g.coverMediaId === params.id) g.coverMediaId = null;
        g.media.splice(i, 1);
        persist();
        return new HttpResponse(null, { status: 204 });
      }
    }
    return notFound("Media not found");
  }),

  http.patch(`${BASE}/games/:id/media/order`, async ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    if (g.ownerId !== me.id) return forbidden();
    const body = (await request.json()) as { order: string[] };
    body.order.forEach((id, i) => {
      const m = g.media.find((x) => x.id === id);
      if (m) m.sortOrder = i;
    });
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  /* ------------------------------- dev helper ------------------------------- */
  http.post(`${BASE}/__mock/reset`, () => {
    resetDb();
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${BASE}/__mock/simulate-engagement`, async ({ request }) => {
    // Makes a game "buzz" for the e2e / demo: adds a burst of recent likes and reviews from seeded users.
    const s = db();
    const { gameId } = (await request.json()) as { gameId: string };
    const g = s.games.find((x) => x.id === gameId);
    if (!g) return notFound();
    s.users.filter((u) => u.id !== g.ownerId).slice(0, 8).forEach((u) => {
      if (!s.gameLikes.some((l) => l.gameId === g.id && l.userId === u.id)) s.gameLikes.push({ userId: u.id, gameId: g.id, createdAt: new Date().toISOString() });
    });
    persist();
    return HttpResponse.json({ engagement24h: engagement(s, g, Date.now() - DAY) });
  }),
];

/* --------------------------------- helpers --------------------------------- */

function validateGameInput(body: GameInput, creating: boolean) {
  if (creating && body.title !== undefined && body.title.length > 80) return err(422, "VALIDATION_ERROR", "Title can be at most 80 characters.");
  if (body.title !== undefined && body.title.length > 80) return err(422, "VALIDATION_ERROR", "Title can be at most 80 characters.");
  if (body.shortDescription !== undefined && body.shortDescription.length > 160) return err(422, "VALIDATION_ERROR", "Short description can be at most 160 characters.");
  if (body.description !== undefined && body.description.length > 10000) return err(422, "VALIDATION_ERROR", "Description is too long.");
  if (body.tags && (body.tags.length > 8 || body.tags.some((t) => !/^[a-z0-9-]{2,24}$/.test(t)))) return err(422, "VALIDATION_ERROR", "Use up to 8 tags: lowercase letters, numbers and dashes.");
  if (body.platforms) {
    const ok: Platform[] = ["windows", "mac", "linux", "web", "android"];
    if (body.platforms.some((p) => !ok.includes(p))) return err(422, "VALIDATION_ERROR", "Unknown platform.");
  }
  return null;
}

function findMedia(s: DbState, up: { mediaId: string; gameId: string }): DbMedia | undefined {
  if (up.gameId === "me") return avatarMedia.get(up.mediaId);
  return s.games.find((g) => g.id === up.gameId)?.media.find((m) => m.id === up.mediaId);
}

const avatarMedia = new Map<string, DbMedia>();

async function uploadInit(gameId: string | null, request: Request) {
  await delay(60);
  const s = db();
  const me = currentUser(s);
  if (!me) return unauthorized();
  const body = (await request.json()) as { kind?: string; filename?: string; size?: number; mime?: string };
  const kind = body.kind as DbMedia["kind"];
  const limit = LIMITS[kind ?? ""];
  if (!limit) return err(422, "VALIDATION_ERROR", "Unknown upload kind.");
  const g = gameId ? findGame(s, gameId) : null;
  if (gameId && !g) return notFound("Game not found");
  if (g && g.ownerId !== me.id) return forbidden();
  if ((body.size ?? 0) > limit.max) return err(413, "FILE_TOO_LARGE", `That file is too large. The limit for this type is ${limit.label}.`);
  if (!limit.mimes.test(body.mime ?? "") && !(kind === "build" && /\.(zip|exe|dmg|apk|appimage|tar\.gz|tgz)$/i.test(body.filename ?? "")))
    return err(415, "UNSUPPORTED_TYPE", "That file type is not supported.");
  const uploadId = nextId("up");
  const media: DbMedia = {
    id: nextId("m"), gameId: g?.id ?? null, kind, originalName: body.filename ?? "file", mime: body.mime ?? "application/octet-stream",
    sizeBytes: body.size ?? 0, status: "uploading", seed: `${uploadId}-${body.filename}`, sortOrder: 0,
  };
  if (g) {
    if (kind === "cover") g.media = g.media.filter((m) => m.kind !== "cover");
    if (kind === "video") g.media = g.media.filter((m) => m.kind !== "video");
    media.sortOrder = g.media.filter((m) => m.kind === kind).length;
    g.media.push(media);
    if (kind === "cover") g.coverMediaId = media.id;
  } else avatarMedia.set(media.id, media);
  s.uploads[uploadId] = { mediaId: media.id, gameId: g?.id ?? "me" };
  persist();
  return HttpResponse.json({ uploadId, url: `/mock-storage/${uploadId}`, fields: { key: `uploads/${media.id}` }, mediaId: media.id }, { status: 201 });
}

