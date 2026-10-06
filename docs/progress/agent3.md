# Agent 3 progress — media, ranking, worker, infrastructure

Branch: `ccr-bdce6bfe-1odzef` (PLAN.md names `agent3/media-infra`; this session was assigned the former).

## Phase 1 — Monorepo and local environment: done

- pnpm workspace, `tsconfig.base.json`, ESLint 9 (flat) + Prettier, `.nvmrc`, `.editorconfig`.
- `infra/docker-compose.yml`: postgres 16 (pg_trgm + `honeytree_test` db), redis, minio with a
  private and a public bucket, clamav (stream limits raised to fit 2 GB builds), mailpit; api, web
  and worker under the `apps` profile (`infra/docker/Dockerfile`, targets `api|worker|web`).
- `pnpm dev` / `make dev`: starts the backing services, then every workspace `dev` script.
  `pnpm dev:docker` runs everything in containers.
- `.env.example` has every variable all three agents share.
- CI (`.github/workflows/ci.yml`): install, lint, format check, typecheck, test (with postgres and
  redis services and ffmpeg), plus a compose config check.

## Phase 2 — Media pipeline: done, with one caveat

- `packages/media` (`@honeytree/media`): the media Fastify plugin and the code shared with the worker.
  `apps/api/src/modules/media/index.ts` re-exports it, so the path in PLAN.md works.
  Endpoints: uploads (game + avatar), complete, status, delete, reorder, download. Details and the
  OpenAPI entries are in `docs/requests/agent3-to-agent1-media-plugin.md`.
- `apps/worker`: BullMQ workers for `media-scan` (ClamAV INSTREAM), `media-image` (sharp: WebP
  thumb 320 / card 640 / full 1600), `media-video` (ffmpeg: H.264 MP4 720p + WebP poster), hourly
  cleanup of abandoned uploads, requeue of lost jobs.
- Deviation from PLAN.md §3.2: uploads are presigned **PUT**, not presigned POST, because R2 does
  not support POST policies. `fields` stays in the response as `{}`.
- **Caveat:** nothing here has run against real MinIO, R2 or ClamAV (no object store or Docker
  daemon in the development sandbox). Storage is covered by an in-memory implementation and by
  checking the signed URLs; ClamAV by a fake clamd speaking the INSTREAM protocol. The first
  `pnpm dev` with Docker is the real test (Phase 5 checklist: EICAR rejection, upload end to end).

## Phase 3 — Ranking and feed engine: done

- `packages/ranking`: pure functions and 22 unit tests; every constant in `src/config.ts`.
- Worker: `compute-scores` every 5 minutes (and once on boot), nightly `recheck-counters`.
  Counter definitions are in `docs/requests/agent3-to-agent1-counter-definitions.md`.
- `pnpm --filter @honeytree/ranking simulate` prints the three lists for seeded fake traffic.
  Observations from it, for tuning: `rising_score` is relative to a game's own baseline, so a game
  already doing ~100 engagement/day ranks below small games that just doubled. That matches the
  formula in PLAN.md; if "Buzzing" should favour absolute volume, raise the weight of the log term.
- `pnpm --filter @honeytree/worker check:schema` verifies that Agent 1's real database has every
  table and column Agent 3 uses (run it once Agent 1's migration exists).

## Phase 4 — Production deployment: done, not yet run on a real server
- `infra/docker-compose.prod.yml`: Caddy (automatic HTTPS; web on `/`, API on `/api`, `/healthz`),
  postgres 16, redis (`noeviction`, required by BullMQ), clamav, api, worker, web, backup. Only
  Caddy publishes ports. `docker-compose.minio.yml` swaps R2 for self-hosted MinIO.
- `infra/DEPLOY.md`: VPS sizing (4 vCPU / 8 GB), firewall, non-root `deploy` user, Docker install,
  DNS, R2 setup incl. the CORS policy browser uploads need, first deploy, updates, rollback,
  monitoring, backups, disaster restore.
- Storage by env vars only (`S3_*`); `.env.production.example` documents R2 and MinIO.
- Backups: nightly `pg_dump` to a private bucket, 14-day retention (never below 3 kept), weekly
  automatic restore test into a scratch database. The scripts were run for real against PostgreSQL 16
  (dump, restore, retention, min-keep guard, abort paths); only the S3 transfer path is untested.
- `infra/scripts/deploy.sh`: pull -> build -> backup -> migrate -> restart api (wait healthy) ->
  restart rest -> smoke test, automatic fallback to the previous images, `--rollback`, `--dry-run`.
  Checked with `--dry-run` only.
- Log rotation (json-file 10m x 5), `infra/scripts/healthcheck.sh` for cron/heartbeat monitoring,
  optional Uptime Kuma profile, Sentry in the worker (`SENTRY_DSN`).
- Not verifiable in the sandbox (no Docker daemon, no Caddy, no object store): Caddyfile syntax,
  image builds, real R2/MinIO and ClamAV. `docker compose config` accepts all compose files.
- Needs from the other agents: `/healthz` on the API; `start` scripts on `@honeytree/api` and
  `@honeytree/web`; Prisma migrate command in `MIGRATE_COMMAND`; `trustProxy: true` on the API.

## Verification

`pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass. The tests run against
PGlite by default and against real PostgreSQL 16 / Redis 7 when `TEST_DATABASE_URL` / `REDIS_URL`
are set (CI sets both; also run locally that way).

## Requests to other agents

- Agent 1: `docs/requests/agent3-to-agent1-database-contract.md`, `...-media-plugin.md`,
  `...-counter-definitions.md`.
- Agent 2: `docs/requests/agent3-to-agent2-upload-and-media.md`.
