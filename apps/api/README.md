# Honeytree API (`apps/api`)

Fastify + Prisma 7 + PostgreSQL. The contract is [`docs/contract/openapi.yaml`](../../docs/contract/openapi.yaml);
the product rules are in [`PLAN.md`](../../PLAN.md).

## Run it locally

Needs Node ≥ 22 and PostgreSQL 16 (the `pg_trgm` extension ships with it). Redis is optional.

```bash
cd apps/api
npm install                 # also generates the Prisma client (postinstall)
cp .env.example .env        # adjust DATABASE_URL
npm run db:deploy           # apply migrations
npm run db:seed             # 20 users, 40 games, reviews, comments, likes (password: honeytree123, admin: hivemaster)
npm run dev                 # http://localhost:4000  (health: /healthz)
```

Without Redis everything works; leaderboard/feed responses are just not cached and rate limits are per process.

| Script | What it does |
|---|---|
| `npm run dev` | API with auto-reload |
| `npm run build` / `npm start` | compile to `dist/` and run it |
| `npm test` | integration tests (see below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | create a new migration after editing `prisma/schema.prisma` |
| `npm run db:seed -- --force` | wipe and re-seed (the seed refuses to touch a non-empty database otherwise) |

### Tests

The tests run against a real PostgreSQL database and wipe it, so use a dedicated one:

```bash
createdb honeytree_test      # once; override with TEST_DATABASE_URL
npm test
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
| `MEDIA_PUBLIC_BASE_URL` | `http://localhost:9000/honeytree` | public bucket URL; storage keys are appended to it |
| `SESSION_TTL_DAYS` | `30` | |
| `RATE_LIMIT_ENABLED` | `true` | |

## Layout

```
prisma/            schema, migrations (the search migration is hand written), seed
src/app.ts         app assembly: CORS, cookies, rate limit, CSRF origin check, error envelope
src/modules/       one Fastify plugin per area (auth, users, games, likes, reviews, comments,
                   feed, leaderboard, search, moderation, system). `media/` belongs to Agent 3.
src/services/      karma ledger, rating/count rollups, feed interleave, access helpers
src/http/          auth/session, validation, pagination, serializers (DB row -> contract JSON)
tests/             integration tests
```

## Things worth knowing

- **Sessions**: random token in an httpOnly `ht_session` cookie; only its SHA-256 is stored.
- **Counters** (`likes_count`, `rating_avg`, `karma_total`, …) are updated in the same transaction as the action.
- **Karma** is an append-only ledger (`karma_events`); undoing an action inserts a negative `reversal` row.
  Caps are per UTC day (50 from likes, 100 total). See `src/services/karma.ts`.
- **Seed media** uses `placeholder:<name>` storage keys, served as honeycomb SVGs by `GET /placeholders/<name>.svg`.
- **Prisma 7**: the client is generated into `src/generated/prisma` (git-ignored) and needs a driver adapter (`@prisma/adapter-pg`).
