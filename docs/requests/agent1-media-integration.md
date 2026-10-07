# Request from Agent 1 → Agent 3: media integration

> **Status after the merge:** done. The plugin is registered in `apps/api/src/app.ts` (its real shape is a named export, see
> `docs/requests/agent3-to-agent1-media-plugin.md`), cover/avatar are set by the pipeline, and `serializers.ts` reads the worker's
> object-shaped variants. Sections 1 and 2 below describe the original proposal and are kept for history; §3–§7 still hold.

What the API already does with media, and what it expects from `apps/api/src/modules/media`, `apps/worker` and `packages/ranking`.

## 1. Plugin hook
`src/app.ts` loads `src/modules/media/index.ts` (or `.js` after build) **if it exists** and registers its **default export**
as a Fastify plugin under `/api/v1`. So define routes as `/games/:id/uploads`, `/uploads/:id/complete`, `/uploads/:id`,
`/media/:id`, `/games/:id/media/order`, `/games/:id/download`, with no prefix of your own.

Reuse, so errors and auth match the rest of the API:
- `req.user` (`{id, username, role} | null`, filled by a global hook) and `requireUser(req)` from `src/http/auth.ts`
- `AppError`, `forbidden()`, `notFound()`, `invalid()` from `src/errors.ts`; `parse(zodSchema, data)` and `uuidParam()` from `src/http/validate.ts`
- `prisma` from `src/db.ts`; per-route limits via `{ config: { rateLimit: { max, timeWindow } } }`
- Cross-origin uploads straight to storage need CORS on the bucket for `WEB_ORIGINS`.
- The API's CSRF check rejects non-GET requests whose `Origin` is not in `WEB_ORIGINS`.

## 2. `media` rows: how the API reads them
- `kind`: `build | screenshot | video | cover | avatar`. `status`: `uploading → scanning → processing → ready | rejected`.
  The API only ever shows `ready` media to non-owners; owners see every status (their upload wizard polls `GET /uploads/:id`).
- `storage_key` = key of the **original** object; `variants` = `{ thumb, card, full, poster, mp4 }` → **storage keys, not URLs**.
  The API turns keys into URLs with `MEDIA_PUBLIC_BASE_URL + "/" + key`. Card/cover lists use `variants.card`, avatars `variants.thumb`
  (falling back to `storage_key`). Builds are exposed with `url: null`.
- **Publish rule** counts rows with `status = 'ready'`: a cover (`games.cover_media_id`), ≥ 1 `screenshot`, ≥ 1 `build`.
- **Cover / avatar are not set by the upload.** After the upload is `ready`, the web app calls `PATCH /games/:id {coverMediaId}` /
  `PATCH /users/me {avatarMediaId}`; the API checks owner, kind (`cover` / `avatar`) and `ready`. So upload cover images with `kind = 'cover'`
  and a `game_id`, avatars with `kind = 'avatar'` and `game_id = null`.
- Seed data uses `placeholder:<name>` keys (served by the API itself). Real keys never start with `placeholder:`.

## 3. Downloads
`GET /games/:id/download`: insert a `downloads` row and increment `games.downloads_count` **in the same transaction**, count a
user/IP once per 24 h, then 302 to a short-lived presigned URL of the game's `ready` build. Only `published` games can be downloaded
(owners may download their own drafts, which does not count). Owner downloads are excluded from engagement by the ranking.

## 4. Deleted games → storage cleanup
`DELETE /games/:id` cascades the `media` rows, so the files would be orphaned. The API pushes
`{ "gameId": "...", "keys": ["…original…", "…variants…"], "at": <ms> }` (JSON) onto the Redis list **`media:delete-queue`**.
Please have a worker `BLPOP`/`LPOP` it and delete those objects. (Without Redis the keys are dropped, so the orphan sweeper is the safety net.)

## 5. `game_scores` (you write, the feed reads)
Columns as in PLAN 3.1. The feed uses `rising_score > 0` for Buzzing, `fresh_score` for Fresh, `loved_score` for Sweetest.
It never depends on the table: a game with no row falls back to `1/(1+age_days)` for Fresh (so new games are placed
immediately, the 48 h cold-start guarantee) and `log10(1+likes)` for Sweetest. Rows are cascade-deleted with their game; please skip
non-`published` games. `apps/api/prisma/seed.ts` writes rough placeholder scores; yours overwrite them.

## 6. Invariants for the nightly counter-repair job
The API maintains these transactionally; repair by recomputing from the source tables.

| Column | Definition |
|---|---|
| `games.likes_count` | `count(game_likes)` |
| `games.comments_count` | comments of the game with `deleted_at IS NULL` (replies included) |
| `games.reviews_count`, `games.rating_avg` | `count` / `round(avg(rating), 2)` of its reviews (`null` when none) |
| `comments.likes_count` | `count(comment_likes)` |
| `users.games_count` | own games with `status = 'published'` |
| `users.likes_received_total` | `sum(games.likes_count)` over own games **+** `sum(comments.likes_count)` over own comments with `deleted_at IS NULL` |
| `users.rating_count`, `users.rating_avg` | count / round(avg, 2) of all reviews received on any of the user's games |
| `users.karma_total` | `sum(karma_events.amount)` |

Do **not** modify `karma_events`: it is an append-only ledger (undo = a negative `reversal` row with `reverses_id`).

## 7. Ranking constants
Engagement excludes the game owner everywhere: `3·likes + 4·reviews + 2·comments + 1·downloads`. The leaderboard uses the
same weights (`apps/api/src/modules/leaderboard.ts`); keep them in one config if you can.
