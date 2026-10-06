# 🍯 Honeytree — Implementation Plan

Honeytree is an online platform where **game creators** upload games (builds, a trailer video and screenshots) and **gamers** discover, download, like, review and comment on them.

This plan is written so that **three independent agents** can build it **in parallel**. The agents share one contract: the data model, the API and the folder layout below. Each agent owns its own folders and must not edit another agent's folders. Integration happens in the final phase.

We build and test **locally first** (Docker Compose), then deploy to a **server**.

---

## 1. Product scope

### 1.1 Navigation
- Top bar on every page: **logo (bee + "honeytree")**, **search bar**, three tabs: **Feed · Leaderboard · Profile**, plus a login/avatar menu and an **"Upload game"** button.
- Every account can play and create. There is no separate creator account: you become a creator once you publish a game.

### 1.2 Feed tab
- A **"🐝 Buzzing now"** carousel at the top, showing rising games.
- Below it, a mixed infinite feed of game cards. Each card shows a badge:
  - **🆕 Fresh Nectar**: a new game
  - **🍯 Sweetest**: a game with many likes
  - **🐝 Buzzing**: a game that is rising fast
- Each card shows the cover, title, creator, tags, like count, average rating, download count and a like button.

### 1.3 Game page
- Screenshot gallery, trailer video player, description, tags, platform and version, file size, **Download** button.
- Like button with a counter.
- **Reviews**: a 1–5 star rating and text. Each user can leave one review per game and can edit it.
- **Comments**: a comment is either a normal comment or a **💡 suggestion**. Replies go one level deep. **Every comment can be liked.** The game's creator can mark a suggestion as "accepted ✅".
- Report button, for abuse or malware.

### 1.4 Profile tab
- Avatar, username, bio and links.
- **Stats**: **likes received**, **number of games**, **average review rating** (with the number of reviews), and **karma**.
- Tabs on the profile: Games · Reviews written · Activity.
- On your own profile: edit profile, manage games (edit, unpublish, delete), and upload a new game.

### 1.5 Leaderboard tab
- Three boards: **Top Games**, **Top Creators** (by likes received), and **Top Karma** (most active community members).
- Period switch: **This week · This month · All time**.

### 1.6 Search
- A search bar in the top bar with an autocomplete dropdown that shows games and users.
- A full results page at `/search?q=…` with **Games | Creators** tabs and tag filters.
- Search tolerates typos (trigram matching).

### 1.7 Karma
Karma goes to the **user who performs the action**:

| Action | Karma |
|---|---|
| Like a game | +1 |
| Like a comment | +1 |
| Write a comment | +2 |
| Write a suggestion | +3 |
| Write a review (≥ 20 characters) | +3 |
| *(optional)* Your suggestion gets accepted by the creator | +10 |

Rules:
- Undoing an action reverses its karma, so unliking or deleting removes the points again.
- You earn no karma for actions on your own games or comments.
- Daily cap: at most **50 karma per day** from likes, and **100 karma per day** in total.
- Karma is stored as an append-only ledger (`karma_events`) plus a cached total on the user.

### 1.8 Visual identity: bee and honey theme
| Token | Hex | Use |
|---|---|---|
| `honey-500` | `#F5B700` | primary buttons, active tab, like button |
| `honey-300` | `#FFD45C` | hover, highlights |
| `amber-600` | `#D98E04` | badges, links |
| `comb-50` | `#FFF8E1` | page background (light mode) |
| `wax-100` | `#FDEBB3` | cards and panels |
| `bark-700` | `#6B4226` | secondary text, borders |
| `bark-900` | `#3B2414` | headings, top bar, dark-mode background |
| `leaf-500` | `#6A8D3A` | success, "accepted" suggestion |
| `ember-600` | `#B23A1E` | errors, destructive actions |

- Hexagon (honeycomb) motifs for avatars, badges and section dividers. Rounded cards. A small bee icon on the like button with a "buzz" micro-animation.
- Fonts: **Fredoka** for headings and **Inter** for body text.
- Light mode and dark mode. Dark mode uses a brown background with honey accents.
- Body text must meet WCAG AA contrast. Never put white text on `honey-500`; use `bark-900` on it.

---

## 2. Tech stack (fixed — all agents use this)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces |
| Frontend | Next.js (App Router) + React + Tailwind CSS + TanStack Query |
| API | Node.js + Fastify, with zod validation |
| Database | PostgreSQL 16 + Prisma ORM; `pg_trgm` and full-text search |
| Cache / queues | Redis + BullMQ |
| File storage | S3-compatible: **MinIO** locally, **Cloudflare R2** (no egress fees, which matters for game downloads) or MinIO in production |
| Media processing | `sharp` for images, `ffmpeg` for video |
| Malware scanning | ClamAV |
| Auth | Email + password (argon2), session in an httpOnly cookie, stored in Redis/DB |
| Tests | Vitest for unit and integration tests, Playwright for end-to-end tests |
| Local env | Docker Compose |
| Production | One Ubuntu VPS with Docker Compose + Caddy for automatic HTTPS |

### 2.1 Repository layout and ownership

```
honeytree/
├── PLAN.md                     (shared, read-only for agents)
├── docs/contract/openapi.yaml  Agent 1 (others read it)
├── apps/
│   ├── api/                    Agent 1  (except src/modules/media/** → Agent 3)
│   │   └── prisma/             Agent 1  (the only owner of migrations)
│   ├── web/                    Agent 2
│   └── worker/                 Agent 3
├── packages/
│   ├── ranking/                Agent 3  (pure feed/rising functions + tests)
│   └── ui-tokens/              Agent 2  (honey theme tokens)
├── infra/                      Agent 3  (docker-compose, Caddy, deploy scripts)
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .github/   Agent 3
```

**Ownership rule:** an agent never edits files it does not own. If it needs something from another agent's area, such as a new column or endpoint, it writes the request in `docs/requests/<agent>-<topic>.md` and builds against a stub or mock in the meantime.

**Git:** each agent works on its own branch (`agent1/api`, `agent2/web`, `agent3/media-infra`) and opens a PR into `main` at the end of each phase.

### 2.2 Local ports
web `3000` · api `4000` · postgres `5432` · redis `6379` · minio `9000` (console `9001`) · mailpit `8025` · clamav `3310`

---

## 3. Shared contract

### 3.1 Data model (Agent 1 implements it in Prisma; everyone codes against it)

- **users**: id, username (unique), email (unique), password_hash, display_name, avatar_media_id, bio, links (json), role (`user` | `admin`), karma_total, likes_received_total, games_count, rating_avg, rating_count, created_at
- **sessions**: id, user_id, expires_at
- **games**: id, owner_id, slug (unique), title, short_description, description (markdown), tags[], platforms[] (`windows` | `mac` | `linux` | `web` | `android`), version, status (`draft` | `published` | `unpublished` | `removed`), cover_media_id, likes_count, downloads_count, comments_count, reviews_count, rating_avg, published_at, created_at, updated_at, search_vector (tsvector)
- **media**: id, game_id (nullable for avatars), owner_id, kind (`build` | `screenshot` | `video` | `cover` | `avatar`), storage_key, original_name, mime, size_bytes, status (`uploading` | `scanning` | `processing` | `ready` | `rejected`), variants (json: thumbnails, webp, mp4 720p, poster), sort_order, created_at
- **game_likes**: (user_id, game_id) PK, created_at
- **reviews**: id, game_id, user_id, rating (1–5), body, created_at, updated_at. Unique on (game_id, user_id).
- **comments**: id, game_id, user_id, parent_id (nullable, one level only), kind (`comment` | `suggestion`), body, accepted_at (nullable), likes_count, deleted_at, created_at
- **comment_likes**: (user_id, comment_id) PK, created_at
- **karma_events**: id, user_id, amount, reason (`like_game` | `like_comment` | `comment` | `suggestion` | `review` | `suggestion_accepted` | `reversal`), ref_type, ref_id, created_at
- **downloads**: id, game_id, user_id (nullable), ip_hash, created_at. Repeat downloads from the same user or IP within 24 h are counted once.
- **game_scores**: game_id PK, fresh_score, loved_score, rising_score, engagement_24h, engagement_7d, computed_at. **Written by Agent 3's worker, read by Agent 1's feed endpoint.**
- **reports**: id, reporter_id, target_type, target_id, reason, status, created_at

Counters on `games` and `users` are updated in the same database transaction as the like, review or comment. The worker also re-checks them nightly.

### 3.2 API (prefix `/api/v1`, JSON)

- **Errors:** `{ "error": { "code": "STRING", "message": "…" } }`
- **Pagination:** cursor based, `?cursor=&limit=`, response `{ items, nextCursor }`

| Area | Endpoints | Owner |
|---|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | A1 |
| Users | `GET /users/:username` (profile + stats), `PATCH /users/me`, `GET /users/:username/games`, `GET /users/:username/reviews` | A1 |
| Games | `POST /games` (create draft), `GET /games/:slug`, `PATCH /games/:id`, `POST /games/:id/publish`, `POST /games/:id/unpublish`, `DELETE /games/:id` | A1 |
| Likes | `PUT /games/:id/like`, `DELETE /games/:id/like` | A1 |
| Reviews | `GET /games/:id/reviews`, `POST /games/:id/reviews`, `PATCH /reviews/:id`, `DELETE /reviews/:id` | A1 |
| Comments | `GET /games/:id/comments`, `POST /games/:id/comments` `{body, kind, parentId?}`, `DELETE /comments/:id`, `PUT/DELETE /comments/:id/like`, `POST /comments/:id/accept` | A1 |
| Feed | `GET /feed?cursor=` (mixed items, each with a `badge`), `GET /feed/buzzing` | A1 (reads `game_scores`) |
| Leaderboard | `GET /leaderboard?type=games\|creators\|karma&period=week\|month\|all` | A1 |
| Search | `GET /search?q=&type=games\|users&tags=&cursor=`, `GET /search/suggest?q=` | A1 |
| Uploads | `POST /games/:id/uploads` `{kind, filename, size, mime}` → `{uploadId, url, fields}` (presigned), `POST /uploads/:id/complete`, `GET /uploads/:id`, `DELETE /media/:id`, `PATCH /games/:id/media/order` | **A3** |
| Download | `GET /games/:id/download` → records the download, then 302 redirects to a short-lived presigned URL | **A3** |
| Reports | `POST /reports` | A1 |

**Every response that includes a game or comment also returns `likedByMe`**, so the UI can show the like state.

**Publish rule:** a game can only be published if it has a title, a cover, at least one screenshot, and at least one `ready` build.

**Upload limits:** build ≤ 2 GB (zip, exe, dmg, apk, AppImage, tar.gz), video ≤ 300 MB, image ≤ 10 MB.

### 3.3 Feed algorithm (Agent 3 implements it in `packages/ranking` + worker)

Engagement in a time window counts unique users and excludes the game's owner:
`E(window) = 3·likes + 4·reviews + 2·comments + 1·downloads`

| Score | Purpose | Formula (all constants in a config file) |
|---|---|---|
| **fresh_score** | new games | Only for games published ≤ 14 days ago: `1 / (1 + age_days)`, multiplied by a completeness boost (×1.2 if the game has a video and ≥ 3 screenshots) |
| **loved_score** | most liked | `log10(1 + likes_total) + log10(1 + likes_30d) + bayes_rating / 5`, where `bayes_rating = (5·global_avg + Σratings) / (5 + n_reviews)` |
| **rising_score** | rising fast | `(E_24h + 1) / (E_prev7d_daily_avg + 2) · log2(2 + E_24h)`. Only applies when `E_24h ≥ 5` and the game's age is ≤ 90 days |

- The worker recomputes `game_scores` **every 5 minutes**.
- The mixed feed (`/feed`) interleaves the three lists in the pattern **Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest, …**, with no duplicates. Each item carries the badge of the list it came from. Order inside each list is by its score.
- **Cold start:** every newly published game is guaranteed a place in the Fresh slots for its first 48 hours.
- If `game_scores` is empty, for example before the worker exists, the feed falls back to newest-first. This lets Agent 1 build the feed without waiting for Agent 3.

---

## 4. Agent assignments and phases

Each phase ends with a PR and a short `docs/progress/<agent>.md` note: what was done, what is stubbed, and any requests to other agents.

### 🐝 Agent 1 — Backend API and data ("The Hive")
Owns `apps/api` (except the media module), `apps/api/prisma`, and `docs/contract/openapi.yaml`.

**Phase 1 — Foundation**
- Write `docs/contract/openapi.yaml` from section 3.2. Do this first and push it early, because Agent 2 mocks against it.
- Fastify app skeleton: config, error format, zod validation, request logging, health check `/healthz`.
- Full Prisma schema for **all** tables in 3.1, including `media` and `game_scores`; initial migration; enable the `pg_trgm` extension.
- Auth: register, login, logout, me; argon2; session cookie; auth middleware; rate limiting on auth routes.
- Seed script: 20 users, 40 games with tags, reviews, comments and likes. Point media at placeholder images.

**Phase 2 — Games and social core**
- Game CRUD, draft → publish flow with the publish rule, slug generation, ownership checks.
- Likes on games, reviews, comments (one level of replies, kinds, soft delete), comment likes, accepting suggestions.
- Karma service: ledger, reversals, self-action exclusion, daily caps. All in the same transaction as the action.
- Profile endpoint with stats: likes received, games count, average rating, karma.

**Phase 3 — Discovery**
- Search: tsvector on games (title weight A, tags B, description C) plus trigram matching on title and username; suggest endpoint.
- Leaderboard queries for the three types and three periods, cached in Redis for 5 minutes.
- Feed endpoints that read `game_scores` and interleave as in 3.3, with the newest-first fallback.
- Reports endpoint; minimal admin action to set a game's status to `removed`.

**Phase 4 — Hardening**
- Integration tests against a test database for every endpoint, including karma edge cases (unlike, own content, caps).
- Rate limits on write endpoints. Input length limits. Strip HTML from markdown output.
- Register Agent 3's media plugin (`apps/api/src/modules/media`) in the app.

### 🍯 Agent 2 — Web frontend ("The Comb")
Owns `apps/web` and `packages/ui-tokens`.

**Phase 1 — Design system and shell** (needs no API)
- `ui-tokens`: the honey palette from 1.8, typography, spacing, light and dark themes.
- Components: Button, HexAvatar, Badge (Fresh / Sweetest / Buzzing), GameCard, StarRating, LikeButton with the bee "buzz" animation, Tabs, Modal, Toast, Skeleton loaders, EmptyState.
- App shell: top bar with logo, search bar, Feed · Leaderboard · Profile tabs, avatar menu, Upload button; responsive mobile layout with a bottom tab bar.
- A mock API (MSW) generated from `docs/contract/openapi.yaml` with realistic fake data.

**Phase 2 — Core pages**
- Feed: Buzzing carousel and an infinite mixed feed with badges.
- Game page: gallery with lightbox, video player, download button, like, reviews (list, form, edit), comments (threads, suggestion tag, comment likes, "accept" for the creator).
- Profile: header, the four stat tiles (likes received, games, average rating, karma), Games / Reviews / Activity tabs, edit profile.
- Leaderboard: three boards and the period switch, with hexagon rank medals for the top 3.

**Phase 3 — Flows**
- Login and register pages; protected actions open a login modal.
- **Upload wizard**: (1) details and tags → (2) build file → (3) cover, screenshots and video, with drag-to-reorder → (4) preview → publish. Direct-to-storage upload with a progress bar, then poll the upload status (scanning → processing → ready / rejected).
- Search: autocomplete dropdown with keyboard navigation, and the `/search` results page with tabs and tag filters.
- Optimistic likes and counters; a "+1 karma 🍯" toast after actions that earn karma.

**Phase 4 — Polish and integration**
- Switch from mocks to the real API via an env flag. Fix any contract mismatches by filing a request to Agent 1; do not work around them.
- Accessibility: keyboard navigation, focus states, alt text, contrast check. SEO metadata and Open Graph images for game pages.
- Playwright end-to-end tests: sign up → upload → publish → another user likes, reviews and comments → profile stats and leaderboard update.

### 🐝 Agent 3 — Media, ranking, worker and infrastructure ("The Beekeeper")
Owns `apps/worker`, `packages/ranking`, `apps/api/src/modules/media`, `infra/`, the root workspace files and CI.

**Phase 1 — Monorepo and local environment** (do this first; it is quick and the others build on it)
- Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint and Prettier.
- `infra/docker-compose.yml`: postgres, redis, minio (bucket created automatically), clamav, mailpit, and api, web and worker services.
- `.env.example`; one command to start everything locally (`pnpm dev` or `make dev`).
- CI on GitHub Actions: install, lint, typecheck, test for all workspaces.

**Phase 2 — Media pipeline**
- Media module as a self-contained Fastify plugin: presigned upload, complete, status, delete, reorder, download with deduplicated counting.
- Validate size and MIME type on request, then check the file's magic bytes after upload.
- Worker jobs on BullMQ:
  - **scan**: ClamAV scans every build; an infected file is marked `rejected`.
  - **image**: `sharp` produces WebP variants (thumb 320, card 640, full 1600).
  - **video**: `ffmpeg` produces H.264 MP4 at 720p, plus a poster frame.
- Cleanup job for abandoned uploads (`uploading` for more than 24 h).

**Phase 3 — Ranking and feed engine**
- `packages/ranking`: pure functions for engagement, fresh, loved and rising scores, and the interleave and deduplication logic, with unit tests for each formula.
- Worker job every 5 minutes: compute and upsert `game_scores`.
- Nightly job: re-check the cached counters on games and users and fix any drift.
- Simulation script: generate fake engagement over time and print the resulting Buzzing, Fresh and Sweetest lists, so the constants can be tuned.

**Phase 4 — Production deployment**
- `infra/docker-compose.prod.yml` with Caddy as reverse proxy and automatic HTTPS for the domain; web on `/` and api on `/api`.
- Server guide `infra/DEPLOY.md`: VPS sizing (4 vCPU / 8 GB to start), firewall, non-root deploy user, Docker install.
- Storage: switch to Cloudflare R2 (or MinIO with a volume) using env vars only.
- Backups: nightly `pg_dump` to object storage with 14-day retention, plus a tested restore procedure.
- Deploy script (pull → migrate → restart, keeping downtime minimal), log rotation, uptime monitoring, error tracking.

---

## 5. Phase 5 — Integration (all three agents)

1. Merge all branches into `main`. Agent 1 registers the media plugin; Agent 2 turns off the mocks.
2. Local end-to-end checklist. Run it on a fresh `docker compose up` with the seed data:
   - [ ] Register, log in, edit profile and avatar
   - [ ] Create a game, upload a build, cover, 3 screenshots and a video; all reach `ready`; publish
   - [ ] An EICAR test file is rejected by the scanner
   - [ ] A second user downloads the game (the counter goes up once), likes it, reviews it, comments, and posts a suggestion
   - [ ] The creator likes the suggestion and accepts it
   - [ ] Karma totals match the rules in 1.7; unliking reverses karma; no karma for actions on your own content
   - [ ] The profile shows the correct likes received, games count, average rating and karma
   - [ ] The new game appears as 🆕 in the feed; simulated engagement makes it 🐝 Buzzing
   - [ ] The leaderboard shows the game, creator and karma rankings for each period
   - [ ] Search finds the game by a misspelled title and finds the creator by username
   - [ ] Mobile layout works, and dark mode looks right
3. All Playwright and integration tests pass in CI.
4. **Deploy to the server** following `infra/DEPLOY.md` and run the same checklist on the live domain.

---

## 6. Kickoff prompts for the agents

Give each agent this repository and the matching prompt:

- **Agent 1:** "Read `PLAN.md`. You are Agent 1 (Backend API and data). Implement your Phases 1–4 in order. Only edit the folders you own. Publish `docs/contract/openapi.yaml` first. Work on branch `agent1/api`."
- **Agent 2:** "Read `PLAN.md`. You are Agent 2 (Web frontend). Implement your Phases 1–4 in order. Only edit the folders you own. Use MSW mocks built from `docs/contract/openapi.yaml` until the real API is ready. Work on branch `agent2/web`."
- **Agent 3:** "Read `PLAN.md`. You are Agent 3 (Media, ranking, worker and infrastructure). Do Phase 1 immediately and push it, then Phases 2–4. Only edit the folders you own. Work on branch `agent3/media-infra`."

**Run order:** start all three agents at the same time. The only early dependencies are Agent 3's Phase 1 workspace files and Agent 1's `openapi.yaml`, and both should land within the first hour. Until then, the other agents work inside their own folders.

## 7. Out of scope for v1 (later ideas)
Following creators and notifications, in-browser play for web games, game versions and changelogs, creator analytics dashboard, OAuth login (Google, Discord), email verification and password reset (mailpit is already in the local stack for this), localization.
