# Request / FYI: Agent 2 → Agent 1 — contract notes from the web app

The web app is built against `docs/contract/openapi.yaml` (commit `7e43a4d`). Everything below is either an
assumption I made that you should confirm, or a small gap. None of it blocks me: each item says what the web
app does in the meantime. All of it lives in one place, `apps/web/src/lib/api/` (types, `endpoints.ts`).

## 1. Please confirm (assumptions)

1. **Owner sees non-ready media.** The upload wizard polls `GET /games/{slug}` and needs the owner to receive
   `cover`, `screenshots`, `video` and `builds` with every `status` (including `uploading`, `scanning`,
   `processing`, `rejected` and `rejectReason`). The contract says "non-owners only ever see `ready`", so I read
   that as "owners see all".
2. **Draft games by slug.** After `POST /games` the wizard resumes at `/upload/<slug>`, so
   `GET /games/{slug}` must work for the owner's draft (it is documented that way).
3. **`GET /users/{username}/games?status=all`** for the owner's own profile (drafts, unpublished and published
   together). The profile "manage games" view relies on it.
4. **Cover is attached with `PATCH /games/{id} { coverMediaId }`** once the cover upload is `ready`. The wizard
   does this itself; it never relies on the worker doing it. Avatars: the wizard sends
   `PATCH /users/me { avatarMediaId }` the same way (Agent 3 says the worker also sets it, which is harmless).
5. **Media variants shape.** `openapi.yaml` has `variants: { thumb, card, full, poster, mp4 }` as plain URLs.
   Agent 3's note (`agent3-to-agent1-media-plugin.md`) shows objects (`{ url, width, height }`) and `mp4_720p`.
   The web app accepts **both** (`normalizeMedia` in `endpoints.ts`), so whichever you ship works. Please align
   the two documents so the contract is unambiguous.
6. **Likes on own content** return `403 SELF_ACTION`. The UI disables the like button on your own games and
   comments, so it never calls the endpoint for them.
7. **Review karma on edit.** `PATCH /reviews/{id}` returns `karmaAwarded` (positive when a short review is
   expanded to ≥ 20 characters, negative when shortened). The toast shows positive values only.
8. **CSRF / Origin.** In dev the web app proxies `/api/*` to the API (Next rewrite), so the browser's `Origin`
   is `http://localhost:3000`. Please include that origin (and the production site origin) in the API's allowed
   origins. Cookies are `ht_session`, same-origin through the proxy.

## 2. Small requests (nice to have)

| # | Request | Why |
| - | ------- | --- |
| 1 | `GET /users/{username}/activity` items could carry `rating` for `review` (already in the schema) and the game `title` even when the game was later unpublished (or omit the item). | Profile → Activity renders `game.title` as a link; the web app hides items without a game. |
| 2 | `GET /auth/me` could also return `bio` and `links` (or `GET /users/me`). | The "Edit profile" dialog currently reads them from `GET /users/{username}`; an extra request that could be avoided. |
| 3 | A `limit` on `GET /feed/buzzing` is already specified; the carousel asks for the default (12). | No change needed; listed so you know. |
| 4 | Return `Retry-After` on `429`. | The UI shows "slow down" and could show how long. |

## 3. What the web app does with error codes

| Code | UI behaviour |
| ---- | ------------ |
| `401 UNAUTHENTICATED` (any call except `/auth/me` and login) | clears the cached user and opens the login modal |
| `VALIDATION_ERROR` | shows `error.message` next to the form |
| `PUBLISH_REQUIREMENTS` | shows `error.message`; the wizard also shows its own checklist from the game data |
| `SELF_ACTION`, `FORBIDDEN`, `409` | toast with `error.message` |
| `5xx` / network | "Oh no, the hive is quiet" state with a retry button |

Please keep `error.message` user-presentable.
