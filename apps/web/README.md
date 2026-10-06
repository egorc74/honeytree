# @honeytree/web: "The Comb"

Next.js (App Router) + React + Tailwind + TanStack Query front end for Honeytree. Owned by Agent 2.
Design tokens live in `packages/ui-tokens` (`@honeytree/ui-tokens`).

## Run it

```bash
pnpm install
# 1. Standalone, no backend: the API is served by in-browser MSW mocks (seeded: 20 users, 40 games)
pnpm --filter @honeytree/web dev:mock          # http://localhost:3000   demo login: demo@honeytree.dev / honeytree123

# 2. Against the real API (docker compose up, API on :4000). Mocking is off by default.
pnpm --filter @honeytree/web dev
```

Switching between the two is one env flag, `NEXT_PUBLIC_API_MOCKING=enabled|disabled` (see `.env.example`).
In real mode `/api/*` is proxied to `API_ORIGIN` (default `http://localhost:4000`) so the session cookie stays same-origin.

## Scripts

| Script | What it does |
| ------ | ------------ |
| `pnpm test` | Vitest: format helpers, Markdown renderer (XSS), optimistic cache, media normalisation, upload validation, component keyboard behaviour, and the **mock API contract tests** (karma, feed interleave, search, publish rule, upload pipeline) |
| `pnpm test:e2e` | Playwright against a production build with mocks (builds first). Specs: golden path, search, auth modal, axe accessibility (light + dark), responsive/mobile, theme. Set `E2E_BASE_URL` to reuse a running server, `E2E_API=real` to run against the real stack |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint (Next + jsx-a11y rules) |

## Layout

```
src/app/                 routes: / (feed), /games/[slug], /u/[username], /profile, /leaderboard,
                         /search, /login, /register, /upload[/slug]
src/components/ui/       design system: Button, HexAvatar, FeedBadge, StarRating, LikeButton (buzz),
                         Tabs, Modal (native <dialog>), Toast, Skeleton, EmptyState, fields
src/components/          feature components (feed, game, profile, leaderboard, search, upload wizard)
src/lib/api/             typed client: types.ts (contract), endpoints.ts (envelopes/normalisation), keys.ts
src/lib/cache.ts         optimistic updates across every cached copy of a game/comment
src/mocks/               MSW handlers + in-memory db implementing PLAN.md §1.7/§3.3 and openapi.yaml
e2e/  tests/             Playwright and Vitest
```

## Notes for the other agents

- Contract assumptions and requests: `docs/requests/agent2-*.md`.
- Mock mode needs no network (placeholder art is generated SVG). The trailer URL in the mocks points at a public
  sample video, so it will not play offline; the player shows a fallback.
- Docker: `apps/web/Dockerfile` (build context = repo root, `NEXT_OUTPUT=standalone`).
