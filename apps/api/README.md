# Honeytree API (`apps/api`)

Fastify + Prisma 7 + PostgreSQL. The contract is [`docs/contract/openapi.yaml`](../../docs/contract/openapi.yaml);
the product rules are in [`PLAN.md`](../../PLAN.md).

## Run it locally

Needs Node ≥ 22, pnpm (the repo is a pnpm workspace) and PostgreSQL 16 (`pg_trgm` ships with it). Redis and MinIO are
needed for uploads; see below for running without them.

```bash
pnpm install                         # from the repo root; also generates the Prisma client
cp .env.example .env                 # repo root: DATABASE_URL, S3_*, REDIS_URL (the full stack uses `pnpm dev`, see the root README)
cd apps/api
pnpm db:deploy                       # apply migrations
pnpm db:seed                         # 20 users, 40 games, reviews, comments, likes (password: honeytree123, admin: hivemaster)
MEDIA_ENABLED=false pnpm dev         # API only on http://localhost:4000 (health: /healthz), no uploads/downloads
```

The API runs straight from TypeScript source through `tsx` (workspace packages are consumed as source, there is no build step).

**Uploads and downloads** come from the media plugin (`packages/media`, Agent 3), registered in `src/app.ts`. It needs Redis and
S3-compatible storage (MinIO locally, `docker compose -f infra/docker-compose.yml up -d`) plus the `S3_*` variables, and it fails fast
at start-up without them. `MEDIA_ENABLED=false` skips it. Without Redis for the API's *own* caching, leaderboard/feed responses are
simply not cached and rate limits are per process.

| Script | What it does |
|---|---|
| `pnpm dev` | API with auto-reload |
| `pnpm start` | run the API (production) |
| `pnpm test` | integration tests (see below) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:migrate` | create a new migration after editing `prisma/schema.prisma` |
| `pnpm db:seed --force` | wipe and re-seed (the seed refuses to touch a non-empty database otherwise) |

### Tests

The tests run against a real PostgreSQL database and wipe it, so use a dedicated one:

```bash
createdb honeytree_test      # once; override with TEST_DATABASE_URL
pnpm test
```

Migrations are applied to the test database automatically before the run.

## Environment

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | – | required |
| `REDIS_URL` | empty | enables caching + shared rate-limit store |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | |
| `WEB_ORIGINS` | `http://localhost:3000` | comma separated; CORS **and** the CSRF origin check |
| `API_PUBLIC_URL` | `http://localhost:4000` | used for placeholder image URLs |
| `S3_PUBLIC_BASE_URL` | `http://localhost:9000/honeytree-public` | public bucket URL shared with the media plugin/worker; storage keys are appended to it (`MEDIA_PUBLIC_BASE_URL` overrides it for the API only) |
| `MEDIA_ENABLED` | `true` | `false` runs the API without the media plugin |
| `SESSION_TTL_DAYS` | `30` | |
| `RATE_LIMIT_ENABLED` | `true` | |

## Layout

```
prisma/            schema, migrations (the search migration is hand written), seed
src/app.ts         app assembly: CORS, cookies, rate limit, CSRF origin check, error envelope
src/modules/       one Fastify plugin per area (auth, users, games, likes, reviews, comments,
                   feed, leaderboard, search, moderation, system). `media/` is Agent 3's thin re-export of `packages/media`.
src/services/      karma ledger, rating/count rollups, feed interleave, access helpers
src/http/          auth/session, validation, pagination, serializers (DB row -> contract JSON)
tests/             integration tests
```

## Things worth knowing

- **Sessions**: random token in an httpOnly `ht_session` cookie; only its SHA-256 is stored.
- **Counters** (`likes_count`, `rating_avg`, `karma_total`, …) are updated in the same transaction as the action.
- **Karma** is an append-only ledger (`karma_events`); undoing an action inserts a negative `reversal` row.
  Caps are per UTC day (50 from likes, 100 total). See `src/services/karma.ts`.
- **Timestamps** are `timestamptz` and **ids** have a DB default (`gen_random_uuid()`), so raw-SQL writers (the media plugin, the worker) work against the same tables.
- **Seed media** uses `placeholder:<name>` storage keys, served as honeycomb SVGs by `GET /placeholders/<name>.svg`.
- **Prisma 7**: the client is generated into `src/generated/prisma` (git-ignored) and needs a driver adapter (`@prisma/adapter-pg`).
