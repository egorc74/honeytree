/**
 * MSW handlers implementing PLAN.md §3.2 against the in-memory db.
 * Paths use a `*` host prefix so they match both the browser (relative) and
 * Node/SSR (absolute) request URLs.
 */
import { delay, http, HttpResponse } from "msw";
import type { ActivityItem, CommentKind, GameInput, LeaderboardEntry, MediaStatus, Platform, UserLink } from "@/lib/api/types";
import {
  awardKarma, currentUser, db, engagement, feedLists, gameStats, karmaTotal, mixedFeed, MIN_REVIEW_KARMA_LENGTH,
  nextId, periodStart, persist, resetDb, reverseKarma, slugify, toComment, toGame, toGameDetail, toProfile,
  toMe, toReview, toUserCard, userSummary, mediaItem, type DbGame, type DbMedia, type DbState,
} from "./db";
import { placeholderAvatar } from "./placeholder";


const BASE = "*/api/v1";
const DAY = 86_400_000;

function err(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}
const unauthorized = () => err(401, "UNAUTHENTICATED", "Please log in to do that.");
const selfAction = (m: string) => err(403, "SELF_ACTION", m);
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
  if (rejected) {
    m.rejectReason = "Malware detected";
    return "rejected";
  }
  if (t < 1400) return "processing";
  return "ready";
}
function settle(m: DbMedia) {
  const next = pipelineStatus(m);
  if (next !== m.status) m.status = next;
  return m;
}

const IMG = /\.(png|jpe?g|webp|gif)$/i;
const LIMITS: Record<string, { max: number; ext: RegExp; label: string }> = {
  build: { max: 2 * 1024 ** 3, ext: /\.(zip|exe|dmg|apk|appimage|tar\.gz|tgz)$/i, label: "2 GB" },
  video: { max: 300 * 1024 ** 2, ext: /\.(mp4|mov|webm)$/i, label: "300 MB" },
  screenshot: { max: 10 * 1024 ** 2, ext: IMG, label: "10 MB" },
  cover: { max: 10 * 1024 ** 2, ext: IMG, label: "10 MB" },
  avatar: { max: 10 * 1024 ** 2, ext: IMG, label: "10 MB" },
};

function gamesSnapshot(s: DbState, meId: string | null, ids: DbGame[]) {
  return ids.map((g) => toGame(s, g, meId));
}

export const handlers = [
  /* ------------------------------- auth ------------------------------- */
  http.post(`${BASE}/auth/register`, async ({ request }) => {
    await delay(80);
    const s = db();
    const body = (await request.json()) as { username?: string; email?: string; password?: string; displayName?: string };
    const username = (body.username ?? "").trim();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return err(422, "VALIDATION_ERROR", "Username must be 3–24 lowercase letters, numbers or underscores.");
    if (!/^\S+@\S+\.\S+$/.test(body.email ?? "")) return err(422, "VALIDATION_ERROR", "Enter a valid email address.");
    if ((body.password ?? "").length < 8) return err(422, "VALIDATION_ERROR", "Password must be at least 8 characters.");
    if (s.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return err(409, "USERNAME_TAKEN", "That username is taken.");
    if (s.users.some((u) => u.email.toLowerCase() === body.email!.toLowerCase())) return err(409, "EMAIL_TAKEN", "That email is already registered.");
    const user = {
      id: nextId("u"), username, email: body.email!, password: body.password!, displayName: body.displayName?.trim() || username, bio: "", links: [] as UserLink[], role: "user" as const,
      avatarUrl: placeholderAvatar(username, username), createdAt: new Date().toISOString(),
    };
    s.users.push(user);
    s.sessionUserId = user.id;
    persist();
    return HttpResponse.json({ user: toMe(s, user) }, { status: 201 });
  }),

  http.post(`${BASE}/auth/login`, async ({ request }) => {
    await delay(80);
    const s = db();
    const body = (await request.json()) as { identifier?: string; password?: string };
    const id = (body.identifier ?? "").toLowerCase();
    const user = s.users.find((u) => u.email.toLowerCase() === id || u.username.toLowerCase() === id);
    if (!user || user.password !== body.password) return err(401, "INVALID_CREDENTIALS", "Wrong email or password.");
    s.sessionUserId = user.id;
    persist();
    return HttpResponse.json({ user: toMe(s, user) });
  }),

  http.post(`${BASE}/auth/logout`, () => {
    db().sessionUserId = null;
    persist();
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(`${BASE}/auth/me`, () => {
    const s = db();
    const me = currentUser(s);
    return me ? HttpResponse.json({ user: toMe(s, me) }) : unauthorized();
  }),

  /* ------------------------------- users ------------------------------- */
  http.patch(`${BASE}/users/me`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as { displayName?: string; bio?: string; links?: UserLink[]; avatarMediaId?: string | null };
    if (body.displayName !== undefined) {
      if (!body.displayName.trim() || body.displayName.length > 40) return err(422, "VALIDATION_ERROR", "Display name must be 1–40 characters.");
      me.displayName = body.displayName.trim();
    }
    if (body.bio !== undefined) {
      if (body.bio.length > 500) return err(422, "VALIDATION_ERROR", "Bio can be at most 500 characters.");
      me.bio = body.bio;
    }
    if (body.links) {
      if (body.links.length > 5 || body.links.some((l) => !l.label?.trim() || !/^https?:\/\//.test(l.url ?? ""))) return err(422, "VALIDATION_ERROR", "Links need a label and an http(s) URL (max 5).");
      me.links = body.links.map((l) => ({ label: l.label.trim().slice(0, 30), url: l.url }));
    }
    if (body.avatarMediaId) {
      const m = avatarMedia.get(body.avatarMediaId);
      if (!m || m.status !== "ready") return err(422, "VALIDATION_ERROR", "That avatar is not ready yet.");
      me.avatarUrl = placeholderAvatar(m.seed + me.username, me.displayName);
    }
    persist();
    return HttpResponse.json({ user: toProfile(s, me) });
  }),

  http.get(`${BASE}/users/:username`, async ({ params }) => {
    await delay(60);
    const s = db();
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    return HttpResponse.json({ user: toProfile(s, u) });
  }),

  http.get(`${BASE}/users/:username/games`, ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    const own = me?.id === u.id;
    const want = own ? (new URL(request.url).searchParams.get("status") ?? "published") : "published";
    const list = s.games
      .filter((g) => g.ownerId === u.id && g.status !== "removed" && (want === "all" || g.status === want))
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
        return { ...toReview(s, r), game: { id: tg.id, slug: tg.slug, title: tg.title, coverUrl: tg.coverUrl } };
      }),
    });
  }),

  http.get(`${BASE}/users/:username/activity`, ({ params }) => {
    const s = db();
    const u = s.users.find((x) => x.username.toLowerCase() === String(params.username).toLowerCase());
    if (!u) return notFound("User not found");
    const title = (gameId: string) => {
      const g = s.games.find((x) => x.id === gameId && x.status === "published");
      return g ? { id: g.id, slug: g.slug, title: g.title } : null;
    };
    const items: ActivityItem[] = [];
    const push = (it: Omit<ActivityItem, "game"> & { game: ActivityItem["game"] | null }) => it.game && items.push(it as ActivityItem);
    for (const l of s.gameLikes.filter((x) => x.userId === u.id)) push({ type: "like", createdAt: l.createdAt, game: title(l.gameId) });
    for (const r of s.reviews.filter((x) => x.userId === u.id)) push({ type: "review", createdAt: r.createdAt, game: title(r.gameId), excerpt: r.body, rating: r.rating });
    for (const c of s.comments.filter((x) => x.userId === u.id && !x.deletedAt)) push({ type: c.kind, createdAt: c.createdAt, game: title(c.gameId), excerpt: c.body });
    for (const g of s.games.filter((x) => x.ownerId === u.id && x.status === "published" && x.publishedAt)) push({ type: "published", createdAt: g.publishedAt!, game: { id: g.id, slug: g.slug, title: g.title } });
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return HttpResponse.json({ items: items.slice(0, 30) });
  }),

  /* ------------------------------- games ------------------------------- */
  http.post(`${BASE}/games`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as GameInput;
    const bad = validateGameInput(body, true);
    if (bad) return bad;
    if ((body.title ?? "").trim().length < 3) return err(422, "VALIDATION_ERROR", "Title must be at least 3 characters.");
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
    return HttpResponse.json({ game: toGameDetail(s, g, me.id) }, { status: 201 });
  }),

  http.get(`${BASE}/games/:key`, async ({ params }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    const g = findGame(s, String(params.key));
    if (!g || !visibleTo(g, me?.id ?? null, s)) return notFound("Game not found");
    g.media.forEach(settle);
    return HttpResponse.json({ game: toGameDetail(s, g, me?.id ?? null) });
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
    const { coverMediaId, ...fields } = body;
    if (coverMediaId !== undefined) {
      const m = coverMediaId ? g.media.find((x) => x.id === coverMediaId && x.kind === "cover") : null;
      if (coverMediaId && (!m || settle(m).status !== "ready")) return err(422, "VALIDATION_ERROR", "The cover is not ready yet.");
      g.coverMediaId = coverMediaId;
    }
    Object.assign(g, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
    persist();
    return HttpResponse.json({ game: toGameDetail(s, g, me.id) });
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
    const keys: string[] = [];
    const need = (ok: boolean, key: string, text: string) => ok || (missing.push(text), keys.push(key));
    need(!!g.title.trim(), "title", "a title");
    need(g.media.some((m) => m.id === g.coverMediaId && m.status === "ready"), "cover", "a cover");
    need(g.media.some((m) => m.kind === "screenshot" && m.status === "ready"), "screenshot", "at least one screenshot");
    need(g.media.some((m) => m.kind === "build" && m.status === "ready"), "build", "a build that finished processing");
    if (missing.length) return HttpResponse.json({ error: { code: "PUBLISH_REQUIREMENTS", message: `To publish you still need ${missing.join(", ")}.`, details: { missing: keys } } }, { status: 422 });
    g.status = "published";
    g.publishedAt ??= new Date().toISOString();
    persist();
    return HttpResponse.json({ game: toGameDetail(s, g, me.id) });
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
    return HttpResponse.json({ game: toGameDetail(s, g, me.id) });
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
    if (g.ownerId === me.id) return selfAction("You can’t like your own game.");
    let karmaAwarded = 0;
    if (!s.gameLikes.some((l) => l.gameId === g.id && l.userId === me.id)) {
      s.gameLikes.push({ userId: me.id, gameId: g.id, createdAt: new Date().toISOString() });
      karmaAwarded = awardKarma(s, { userId: me.id, reason: "like_game", refType: "game", refId: g.id });
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
    const reversed = had !== s.gameLikes.length ? reverseKarma(s, me.id, "game", g.id, "like_game") : 0;
    persist();
    return HttpResponse.json({ liked: false, likesCount: gameStats(s, g).likesCount, karmaAwarded: -reversed });
  }),

  /* ------------------------------ reviews ------------------------------ */
  http.get(`${BASE}/games/:id/reviews`, ({ params, request }) => {
    const s = db();
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    const list = s.reviews.filter((r) => r.gameId === g.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = paginate(list, request, 10);
    const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    list.forEach((r) => (distribution[String(r.rating)] += 1));
    const stats = gameStats(s, g);
    return HttpResponse.json({ ...page, items: page.items.map((r) => toReview(s, r)), summary: { ratingAvg: stats.ratingAvg, ratingCount: stats.reviewsCount, distribution } });
  }),

  http.post(`${BASE}/games/:id/reviews`, async ({ params, request }) => {
    await delay(80);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const g = findGame(s, String(params.id));
    if (!g || g.status !== "published") return notFound("Game not found");
    if (g.ownerId === me.id) return selfAction("You can’t review your own game.");
    if (s.reviews.some((r) => r.gameId === g.id && r.userId === me.id)) return err(409, "REVIEW_EXISTS", "You already reviewed this game. Edit your review instead.");
    const body = (await request.json()) as { rating?: number; body?: string };
    if (!Number.isInteger(body.rating) || body.rating! < 1 || body.rating! > 5) return err(422, "VALIDATION_ERROR", "Rating must be 1 to 5 stars.");
    if ((body.body ?? "").length > 4000) return err(422, "VALIDATION_ERROR", "Review is too long.");
    const now = new Date().toISOString();
    const r = { id: nextId("r"), gameId: g.id, userId: me.id, rating: body.rating!, body: (body.body ?? "").trim(), createdAt: now, updatedAt: now };
    s.reviews.push(r);
    const karmaAwarded = r.body.length >= MIN_REVIEW_KARMA_LENGTH ? awardKarma(s, { userId: me.id, reason: "review", refType: "review", refId: r.id }) : 0;
    persist();
    return HttpResponse.json({ review: toReview(s, r), karmaAwarded }, { status: 201 });
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
    // Karma follows the ≥ 20 characters rule: earned when a short review is expanded, reversed when shortened.
    let karmaAwarded = 0;
    const earned = s.karma.filter((k) => k.userId === r.userId && k.refId === r.id).reduce((n, k) => n + k.amount, 0) > 0;
    if (r.body.length >= MIN_REVIEW_KARMA_LENGTH && !earned) karmaAwarded = awardKarma(s, { userId: r.userId, reason: "review", refType: "review", refId: r.id });
    else if (r.body.length < MIN_REVIEW_KARMA_LENGTH && earned) karmaAwarded = -reverseKarma(s, r.userId, "review", r.id, "review");
    persist();
    return HttpResponse.json({ review: toReview(s, r), karmaAwarded });
  }),

  http.delete(`${BASE}/reviews/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const r = s.reviews.find((x) => x.id === params.id);
    if (!r) return notFound("Review not found");
    if (r.userId !== me.id && me.role !== "admin") return forbidden();
    s.reviews = s.reviews.filter((x) => x.id !== r.id);
    const reversed = reverseKarma(s, r.userId, "review", r.id, "review");
    persist();
    return HttpResponse.json({ karmaAwarded: me.id === r.userId ? -reversed : 0 });
  }),

  /* ------------------------------ comments ------------------------------ */
  http.get(`${BASE}/games/:id/comments`, ({ params, request }) => {
    const s = db();
    const me = currentUser(s);
    const g = findGame(s, String(params.id));
    if (!g) return notFound("Game not found");
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "all";
    const sort = url.searchParams.get("sort") ?? "top";
    const all = s.comments.filter((c) => c.gameId === g.id);
    const likes = (id: string) => s.commentLikes.filter((l) => l.commentId === id).length;
    // Soft-deleted comments stay as a placeholder only if they still have replies.
    const tops = all
      .filter((c) => !c.parentId && (kind === "all" || c.kind === kind) && (!c.deletedAt || all.some((r) => r.parentId === c.id && !r.deletedAt)))
      .sort((a, b) => (sort === "top" ? likes(b.id) - likes(a.id) || b.createdAt.localeCompare(a.createdAt) : b.createdAt.localeCompare(a.createdAt)));
    const page = paginate(tops, request, 10);
    return HttpResponse.json({
      ...page,
      items: page.items.map((c) => {
        const replies = all.filter((r) => r.parentId === c.id && !r.deletedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { ...toComment(s, c, me?.id ?? null), replies: replies.map((r) => toComment(s, r, me?.id ?? null)), repliesCount: replies.length };
      }),
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
    // No karma for commenting on your own game.
    const karmaAwarded = g.ownerId === me.id ? 0 : awardKarma(s, { userId: me.id, reason: kind, refType: "comment", refId: c.id });
    persist();
    return HttpResponse.json({ comment: { ...toComment(s, c, me.id), replies: [], repliesCount: 0 }, karmaAwarded }, { status: 201 });
  }),

  http.delete(`${BASE}/comments/:id`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id);
    if (!c) return notFound("Comment not found");
    const owner = s.games.find((x) => x.id === c.gameId)?.ownerId;
    if (c.userId !== me.id && owner !== me.id && me.role !== "admin") return forbidden();
    c.deletedAt = new Date().toISOString();
    const reversed = reverseKarma(s, c.userId, "comment", c.id, c.kind);
    persist();
    return HttpResponse.json({ karmaAwarded: c.userId === me.id ? -reversed : 0 });
  }),

  http.put(`${BASE}/comments/:id/like`, async ({ params }) => {
    await delay(40);
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id && !x.deletedAt);
    if (!c) return notFound("Comment not found");
    if (c.userId === me.id) return selfAction("You can’t like your own comment.");
    let karmaAwarded = 0;
    if (!s.commentLikes.some((l) => l.commentId === c.id && l.userId === me.id)) {
      s.commentLikes.push({ userId: me.id, commentId: c.id, createdAt: new Date().toISOString() });
      karmaAwarded = awardKarma(s, { userId: me.id, reason: "like_comment", refType: "comment", refId: c.id });
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
    const reversed = had !== s.commentLikes.length ? reverseKarma(s, me.id, "comment", c.id, "like_comment") : 0;
    persist();
    return HttpResponse.json({ liked: false, likesCount: s.commentLikes.filter((l) => l.commentId === c.id).length, karmaAwarded: -reversed });
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
    return HttpResponse.json({ comment: toComment(s, c, me.id) });
  }),

  http.delete(`${BASE}/comments/:id/accept`, ({ params }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const c = s.comments.find((x) => x.id === params.id && !x.deletedAt);
    if (!c) return notFound("Comment not found");
    const g = s.games.find((x) => x.id === c.gameId)!;
    if (g.ownerId !== me.id) return forbidden("Only the game's creator can change this.");
    if (c.acceptedAt) {
      c.acceptedAt = null;
      reverseKarma(s, c.userId, "comment", c.id, "suggestion_accepted");
    }
    persist();
    return HttpResponse.json({ comment: toComment(s, c, me.id) });
  }),

  /* ------------------------- feed / leaderboard / search ------------------------- */
  http.get(`${BASE}/feed/buzzing`, async () => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    return HttpResponse.json({ items: feedLists(s).buzzing.slice(0, 12).map((g) => ({ badge: "buzzing", game: toGame(s, g, me?.id ?? null) })) });
  }),

  http.get(`${BASE}/feed`, async ({ request }) => {
    await delay(80);
    const s = db();
    const me = currentUser(s);
    const page = paginate(mixedFeed(s), request, 12);
    return HttpResponse.json({ ...page, items: page.items.map((x) => ({ badge: x.badge, game: toGame(s, x.game, me?.id ?? null) })) });
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
      // games: engagement (likes, reviews, comments, downloads by others) within the period
      rows = s.games.filter((g) => g.status === "published").map((game) => ({ game, score: engagement(s, game, since) }));
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
      .map((r, i) => ({ rank: i + 1, score: r.score, ...(r.game ? { game: toGame(s, r.game, me?.id ?? null) } : { user: toUserCard(s, r.user!) }) }));
    return HttpResponse.json({ type, period: url.searchParams.get("period") ?? "week", items });
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
        return { id: tg.id, slug: tg.slug, title: tg.title, coverUrl: tg.coverUrl };
      });
    const users = s.users
      .map((u) => ({ u, sc: textScore(q, u.username, u.displayName) }))
      .filter((x) => x.sc >= MATCH_THRESHOLD)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 5)
      .map((x) => userSummary(x.u));
    return HttpResponse.json({ games, users });
  }),

  http.get(`${BASE}/search`, async ({ request }) => {
    await delay(60);
    const s = db();
    const me = currentUser(s);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (!q) return err(422, "VALIDATION_ERROR", "q is required.");
    const type = url.searchParams.get("type") ?? "games";
    const tags = (url.searchParams.get("tags") ?? "").split(",").filter(Boolean);
    if (type === "users") {
      const rows = s.users
        .map((u) => ({ u, sc: q ? textScore(q, u.username, u.displayName) : 0.5 }))
        .filter((x) => x.sc >= MATCH_THRESHOLD)
        .sort((a, b) => b.sc - a.sc)
        .map(({ u }) => toUserCard(s, u));
      return HttpResponse.json(paginate(rows, request, 12));
    }
    const matching = s.games
      .filter((g) => g.status === "published")
      .map((g) => ({ g, sc: q ? Math.max(textScore(q, g.title), g.tags.some((t) => t === q.toLowerCase()) ? 1 : 0, textScore(q, g.shortDescription) * 0.6) : 0.5 }))
      .filter((x) => x.sc >= MATCH_THRESHOLD);
    const filtered = matching.filter((x) => tags.every((t) => x.g.tags.includes(t))).sort((a, b) => b.sc - a.sc);
    const page = paginate(filtered, request, 12);
    return HttpResponse.json({ ...page, items: page.items.map((x) => toGame(s, x.g, me?.id ?? null)) });
  }),

  http.get(`${BASE}/tags/popular`, () => {
    const counts = new Map<string, number>();
    db().games.filter((g) => g.status === "published").forEach((g) => g.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return HttpResponse.json({ items: [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 20) });
  }),

  http.post(`${BASE}/reports`, async ({ request }) => {
    const s = db();
    const me = currentUser(s);
    if (!me) return unauthorized();
    const body = (await request.json()) as { targetType?: string; targetId?: string; reason?: string };
    if (!body.targetType || !body.targetId || (body.reason ?? "").trim().length < 3) return err(422, "VALIDATION_ERROR", "Tell us what is wrong (at least 3 characters).");
    const id = nextId("rep");
    s.reports.push({ id, reporterId: me.id, targetType: body.targetType, targetId: body.targetId, reason: body.reason!, createdAt: new Date().toISOString() });
    persist();
    return HttpResponse.json({ report: { id } }, { status: 201 });
  }),

  /* ------------------------------- uploads ------------------------------- */
  http.post(`${BASE}/games/:id/uploads`, async ({ params, request }) => uploadInit(String(params.id), request)),
  // Avatars are not game-bound (Agent 3: POST /users/me/uploads).
  http.post(`${BASE}/users/me/uploads`, async ({ request }) => uploadInit(null, request)),

  // Stand-in for the presigned PUT target (R2/MinIO).
  http.put("*/mock-storage/:uploadId", () => new HttpResponse(null, { status: 200 })),

  http.post(`${BASE}/uploads/:id/complete`, ({ params }) => {
    const s = db();
    const up = s.uploads[String(params.id)];
    if (!up) return notFound("Upload not found");
    const m = findMedia(s, up);
    if (!m) return notFound("Upload not found");
    m.status = "scanning";
    m.pipelineStartedAt = Date.now();
    persist();
    return HttpResponse.json({ media: mediaItem(m) });
  }),

  http.get(`${BASE}/uploads/:id`, ({ params }) => {
    const s = db();
    const up = s.uploads[String(params.id)];
    const m = up && findMedia(s, up);
    if (!up || !m) return notFound("Upload not found");
    settle(m);
    persist();
    return HttpResponse.json({ media: mediaItem(m) });
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
    const body = (await request.json()) as { mediaIds: string[] };
    body.mediaIds.forEach((id, i) => {
      const m = g.media.find((x) => x.id === id && x.kind === "screenshot");
      if (m) m.sortOrder = i;
    });
    persist();
    return HttpResponse.json({ items: g.media.filter((m) => m.kind === "screenshot").sort((a, b) => a.sortOrder - b.sortOrder).map(mediaItem) });
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
  if (!limit) return err(422, "INVALID_UPLOAD", "Unknown upload kind.");
  const g = gameId ? findGame(s, gameId) : null;
  if (gameId && !g) return err(404, "GAME_NOT_FOUND", "Game not found");
  if (g && g.ownerId !== me.id) return forbidden();
  if (!gameId && kind !== "avatar") return err(422, "INVALID_UPLOAD", "Only avatars can be uploaded here.");
  if (gameId && kind === "avatar") return err(422, "INVALID_UPLOAD", "Avatars are uploaded for your profile.");
  if ((body.size ?? 0) > limit.max) return err(422, "INVALID_UPLOAD", `That file is too large. The limit for this type is ${limit.label}.`);
  if (!limit.ext.test(body.filename ?? "")) return err(422, "INVALID_UPLOAD", "That file type is not supported.");
  if (g && kind === "screenshot" && g.media.filter((m) => m.kind === "screenshot").length >= 12) return err(422, "UPLOAD_LIMIT_REACHED", "A game can have at most 12 screenshots.");
  if (g && kind === "build" && g.media.filter((m) => m.kind === "build").length >= 8) return err(422, "UPLOAD_LIMIT_REACHED", "A game can have at most 8 builds.");
  const id = nextId("m");
  const media: DbMedia = {
    id, gameId: g?.id ?? null, kind, originalName: body.filename ?? "file", mime: body.mime ?? "application/octet-stream",
    sizeBytes: body.size ?? 0, status: "uploading", seed: `${id}-${body.filename}`, sortOrder: 0,
  };
  if (g) {
    // A new cover or video replaces the old one.
    if (kind === "cover" || kind === "video") g.media = g.media.filter((m) => m.kind !== kind);
    media.sortOrder = g.media.filter((m) => m.kind === kind).length;
    g.media.push(media);
  } else avatarMedia.set(media.id, media);
  const uploadId = id;
  s.uploads[uploadId] = { mediaId: media.id, gameId: g?.id ?? "me" };
  persist();
  return HttpResponse.json(
    { uploadId, url: `/mock-storage/${uploadId}`, method: "PUT", headers: {}, fields: {}, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), media: mediaItem(media) },
    { status: 201 },
  );
}

