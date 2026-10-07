# Agent 1 progress: backend API and data

Branch: `claude/honeytree-platform-plan-c7x7u1` · Code: `apps/api` · Contract: `docs/contract/openapi.yaml`

## Status: Phases 1–4 done, except registering Agent 3's media plugin (see below)

| Phase | Delivered |
|---|---|
| 1 Foundation | OpenAPI contract (lints clean), Fastify app, Prisma schema for **all** tables of PLAN 3.1, migrations (+ hand-written `pg_trgm`/tsvector migration), auth (argon2, hashed session tokens), rate limits on auth, seed script |
| 2 Games & social | game CRUD + publish rule, game likes, reviews, comments (suggestions, one-level replies, comment likes, accept), karma ledger with reversals/caps/self-exclusion, profile stats |
| 3 Discovery | search (full text + typo tolerance), suggest, popular tags, 3 leaderboards × 3 periods, feed + buzzing carousel (reads `game_scores`, falls back to newest-first), reports + admin remove/restore |
| 4 Hardening | 111 integration tests against a real database (karma edge cases mutation-checked), write-endpoint rate limits, input limits, HTML stripping, CSRF origin check, production build verified |

`npm test` → 111 passing. Run instructions: `apps/api/README.md`.

## Decisions where PLAN.md was open or ambiguous (all reflected in the contract)

- **One path for a game**: `/games/{idOrSlug}`. GET accepts slug or UUID; PATCH/DELETE need the UUID. (`/games/{slug}` and `/games/{id}` as separate paths is ambiguous.)
- **"Likes received"** = likes on the user's games **plus** likes on the user's comments.
- **No self-engagement**: creators get `403 SELF_ACTION` for liking or reviewing their own game; nobody can like their own comment. No karma for comments on your own game or replies inside your own thread.
- **Cover and avatar** are set by `PATCH /games/{id} {coverMediaId}` / `PATCH /users/me {avatarMediaId}` once the upload is `ready` (the API validates ownership, kind and status).
- **`karmaAwarded`** is returned by every write that can change karma, so the web app can show the "+1 🍯" toast. Negative = reversed.
- **Daily caps** use the UTC day. A reversal counts against the day/reason of the event it reverses, so like → unlike → like cannot be farmed. Capped karma is simply not awarded (the like/comment itself always goes through) and is never granted retroactively.
- **Review karma** needs a body of ≥ 20 characters; editing a review across that line awards/reverses it. `suggestion_accepted` (+10) counts toward the 100/day cap.
- **Re-publishing keeps the original `published_at`**, so unpublish/publish cycles cannot reset the "fresh" ranking.
- **Feed** is a 500-item sequence (Buzzing/Fresh/Sweetest interleave, then newest-first tail) cached 60 s in Redis and invalidated on publish/unpublish/delete. Offset cursors.
- **Leaderboard** caches only `(id, score)` for 5 min and hydrates per request, so counters are fresh and `likedByMe` is never shared between viewers.
- **Extra endpoints** the plan's UI needs: `GET /users/{username}/activity`, `GET /tags/popular`, `GET /admin/reports`, `POST /admin/reports/{id}/resolve`, `POST /admin/games/{id}/remove|restore`.
- **Interleave** lives in `apps/api/src/services/interleave.ts` (pure, unit-tested). PLAN 4 also assigns "interleave" to `packages/ranking`; if Agent 3 exports it there, swapping the import is a one-line change.

## For other agents

- **Agent 3**: see `docs/requests/agent1-media-integration.md` (media table semantics, plugin hook, `game_scores`, counter invariants for the nightly repair job).
- **Agent 2**: everything you need is in `docs/contract/openapi.yaml`. Local dev: `npm run db:seed && npm run dev` in `apps/api` gives a populated API on :4000 (log in as any seeded user, password `honeytree123`; `hivemaster` is admin). Send requests with `credentials: 'include'`.

## Not done / limits

- **Media plugin registration (Phase 4)**: `src/app.ts` registers `src/modules/media/index.(ts|js)` automatically *if it exists* (default export = Fastify plugin, mounted under `/api/v1`). That file belongs to Agent 3 and does not exist yet, so uploads and downloads are not testable end to end. Until then tests insert `media` rows directly.
- **Packaging**: I used `npm` inside `apps/api` because the root pnpm workspace (Agent 3, Phase 1) did not exist yet. When it lands, delete `apps/api/package-lock.json` and install through pnpm.
- Replies beyond 50 per thread are counted in `repliesCount` but not returned. Search is offset-paginated. No email verification / password reset (out of scope for v1, see PLAN 7).
