# Agent 1 progress: backend API and data

Branch: `claude/honeytree-platform-plan-c7x7u1` · Code: `apps/api` · Contract: `docs/contract/openapi.yaml`

## Status: Phases 1–4 done and integrated with Agent 2 (web) and Agent 3 (media, worker, infra)

| Phase | Delivered |
|---|---|
| 1 Foundation | OpenAPI contract (lints clean), Fastify app, Prisma schema for **all** tables of PLAN 3.1, migrations (+ hand-written `pg_trgm`/tsvector migration), auth (argon2, hashed session tokens), rate limits on auth, seed script |
| 2 Games & social | game CRUD + publish rule, game likes, reviews, comments (suggestions, one-level replies, comment likes, accept), karma ledger with reversals/caps/self-exclusion, profile stats |
| 3 Discovery | search (full text + typo tolerance), suggest, popular tags, 3 leaderboards × 3 periods, feed + buzzing carousel (reads `game_scores`, falls back to newest-first), reports + admin remove/restore |
| 4 Hardening | 115 integration tests against a real database (karma edge cases mutation-checked), write-endpoint rate limits, input limits, HTML stripping, CSRF origin check, production build verified |

`pnpm test` → 115 passing (111 API + 4 media integration). Run instructions: `apps/api/README.md`.

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

## Integration with the other agents (merge of the three branches)

Merged `ccr-bdce6bfe…` (Agent 3) and `ccr-217eae47…` (Agent 2) into this branch. Only `.gitignore` conflicted (union). Real integration problems found and fixed:

- **Media plugin registered** in `src/app.ts` with `getUser` from our session; `MEDIA_ENABLED=false` runs the API without it; tests inject Agent 3's in-memory storage/queue (`@honeytree/media/testing`).
- **Variant shape**: the worker stores variants as `{ key, width, height }` plus `rejectReason`; my serializers assumed plain key strings and would have crashed (500) on every feed/game/profile response once one upload was processed. They now accept both, map `mp4_720p` → `mp4`, and expose `rejectReason`. Game deletion also collects keys from the object form.
- **DB-level defaults**: Prisma's `uuid(7)`/`@updatedAt` defaults live in the client, so raw-SQL inserts (`INSERT INTO downloads …`) failed with NOT NULL errors. Ids now default to `gen_random_uuid()`, `updated_at` to `now()` (migration `db_level_defaults`).
- **`timestamptz`**: Agent 3's code expects it and `now() - created_at` windows are wrong on a non-UTC server otherwise; all 18 `DateTime` columns converted (migration `timestamptz`, explicit `AT TIME ZONE 'UTC'`). Agent 3's `pnpm --filter @honeytree/worker check:schema` now reports "Schema matches".
- **Workspace**: `apps/api` moved from npm into the pnpm workspace (`@honeytree/media: workspace:*`, `tsx` runtime, `tsconfig` `moduleResolution: bundler`); `start` is `tsx src/server.ts` as `infra/docker/Dockerfile` expects. The compile-to-`dist` build was dropped.
- `S3_PUBLIC_BASE_URL` is now the shared bucket URL variable (`MEDIA_PUBLIC_BASE_URL` still overrides it for the API).
- Contract: media endpoints replaced by Agent 3's real ones (presigned **PUT**, `/users/me/uploads`, `?mediaId=`); cover/avatar are set by the pipeline (the `PATCH` fields remain optional).

Other suites on the merged tree: ranking 22, media 31, worker 29 (3 skipped) passing.

## Not done / limits

- **Agent 2's `package.json` files are missing from their branch** (`apps/web`, `packages/ui-tokens`, and no workspace entry for them), so `apps/web` cannot be installed or built from this repo as it stands. Agent 2 needs to commit them. (A scratch manifest with Next 15 / React 19 / Tailwind 3 / TanStack Query / MSW was enough to run the feed against this API.)
- Not verified end to end: a real upload to MinIO → worker → `ready` (needs Docker; none in this environment), and the web upload wizard against the real plugin.
- `packages/ranking` also implements the feed interleave; the API keeps its own tested copy (`src/services/interleave.ts`). Swapping to the shared one is a one-line change.
- Replies beyond 50 per thread are counted in `repliesCount` but not returned. Search is offset-paginated. No email verification / password reset (out of scope for v1, see PLAN 7).
