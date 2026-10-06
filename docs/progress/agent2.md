# Agent 2 (web frontend): progress

Branch: `ccr-217eae47-2i8s12` (the session branch; PLAN.md suggested `agent2/web`).
Scope: `apps/web` and `packages/ui-tokens` only.

## Phase 1: design system and shell ✅

- `packages/ui-tokens`: the §1.8 palette, fonts (Fredoka headings, Inter body), spacing/radii/motion, light and dark
  semantic themes (`theme.css`), and a Tailwind preset. Tests check the CSS against the TS tokens and assert WCAG AA
  contrast for every text/background pair in both themes.
  - Added `amber-800`, `leaf-700` and a few brown shades (not in the plan's table) because `amber-600` text on
    `comb-50` is only ~2.6:1. `amber-600` is used only as a badge background with `bark-900` text.
- Components: Button, HexAvatar, FeedBadge/Badge, StarRating (+ input), LikeButton with bee buzz animation, Tabs,
  Segmented, Modal (native `<dialog>`), Toast (+ "+N karma 🍯"), Skeletons, EmptyState/ErrorState, form fields.
- Shell: top bar (logo, search combobox, Feed · Leaderboard · Profile, theme toggle, avatar menu, Upload),
  mobile bottom tab bar, skip link, dark mode (persisted, no flash).
- MSW mock API (`src/mocks`): full in-memory backend that implements the karma rules, caps, reversals, the feed
  interleave, typo-tolerant search, publish rule and the upload/scan pipeline (EICAR names are rejected).
  It follows `docs/contract/openapi.yaml` (Agent 1) and Agent 3's upload protocol, and is covered by contract tests.

## Phase 2: core pages ✅

Feed (Buzzing carousel + infinite mixed feed with badges), game page (gallery + lightbox, video, download incl.
multi-build, like, reviews with rating distribution and edit/delete, comments with replies, 💡 suggestions, comment
likes, accept/undo for the creator, filters and sort, report), profile (stat tiles, Games/Reviews/Activity, edit
profile with avatar upload and links, manage games), leaderboard (3 boards × 3 periods, hexagon medals).

## Phase 3: flows ✅

Login/register pages and modal (protected actions resume after login), upload wizard (details → build → media with
drag-to-reorder and keyboard arrows → preview/publish, direct-to-storage PUT with progress, status polling),
search (autocomplete with keyboard navigation, results page with Games | Creators tabs and tag filters),
optimistic likes/counters across all cached lists, karma toasts driven by `karmaAwarded`.

## Phase 4: polish and integration ✅ (mock mode); ⏳ real API

- Mock ↔ real switch is the single flag `NEXT_PUBLIC_API_MOCKING`.
- Accessibility: axe (WCAG 2.1 A/AA) over 8 pages in light and dark, keyboard/focus-trap tests, visible focus
  ring, reduced-motion, alt text, live regions, jsx-a11y lint.
- SEO: per-page metadata, Open Graph/Twitter images from the cover, canonical URL, `VideoGame` JSON-LD,
  server-rendered game and profile pages.
- Playwright: golden path (sign up → upload → publish → another user downloads, likes, reviews, comments and
  suggests → creator accepts → profile stats and leaderboards), EICAR rejection, search, auth modal, a11y,
  responsive.
- **Not done / needs the others:** running the same Playwright specs against the real stack
  (`E2E_API=real`) requires Agent 1's API and Agent 3's compose file (Phase 5). Contract points to confirm are in
  `docs/requests/agent2-to-agent1-contract-notes.md`; storage CORS and CSP in
  `docs/requests/agent2-to-agent3-storage-and-edge.md`.

## Stubs and known limits

- The mock trailer URL is a public sample video (offline: the player shows a fallback).
- `pnpm-lock.yaml`, root `package.json` and `pnpm-workspace.yaml` belong to Agent 3; I used local, untracked copies
  to install and test, so `apps/web` has no committed lockfile entry yet. After Agent 3's workspace lands, run
  `pnpm install` once and commit the lockfile there.
- Markdown is rendered by a small built-in renderer (headings, lists, quotes, code, bold/italic, http(s) links) that
  never emits raw HTML. No images in descriptions.
