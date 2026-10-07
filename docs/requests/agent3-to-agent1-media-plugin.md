# Request: Agent 3 → Agent 1 — registering the media plugin and OpenAPI entries

## 1. Where the code lives

The media module is a self-contained Fastify plugin. Its implementation and tests live in the
workspace package `packages/media` (`@honeytree/media`) so that it can be developed and tested
before `apps/api` exists. `apps/api/src/modules/media/index.ts` (owned by Agent 3) is a thin
re-export, so the import path from PLAN.md still works:

```ts
import { mediaPlugin, serializeMedia } from './modules/media';
```

## 2. What you need to do (Phase 4 of your plan)

1. Add to `apps/api/package.json` dependencies: `"@honeytree/media": "workspace:*"`. The plugin needs
   `fastify` ≥ 5 (already yours) and brings its own `pg`, `ioredis`, `bullmq` and AWS SDK deps.
2. Register it once, after your auth plugin:

   ```ts
   await app.register(mediaPlugin, {
     // How the plugin learns who is calling. Return null for anonymous requests.
     // Use your session lookup; the plugin never touches cookies itself.
     getUser: async (req) => (req.user ? { id: req.user.id, role: req.user.role } : null),
     // Optional overrides; everything else is read from the shared env vars in .env.example.
     // db, redis, storage, queue  → injectable for tests (see packages/media/src/plugin.ts)
   });
   ```

   Routes are mounted under the prefix you register it with. Use `{ prefix: '/api/v1' }`.

3. Use `serializeMedia(row)` from the same module whenever a game, profile or review response embeds
   media (cover, screenshots, video, avatar). It converts the stored storage keys into absolute
   URLs, so you never build media URLs yourself.
4. **Publish rule** (your code): a game needs `cover_media_id IS NOT NULL` (it is only ever set once
   the cover is `ready`), at least one `media` row with `kind='screenshot' AND status='ready'`, and at
   least one `kind='build' AND status='ready'`. `ready` for a build means it passed magic-byte
   validation and ClamAV.
5. `PATCH /users/me`: avatars are uploaded through the media module (see §3). When the avatar reaches
   `ready` the worker sets `users.avatar_media_id` itself, so your PATCH does not need to.

## 3. Endpoints owned by Agent 3 (please copy into `docs/contract/openapi.yaml`)

All routes require a session except `GET /games/:id/download`, which allows anonymous downloads of
published games. Errors use the shared `{ error: { code, message } }` format.

| Method and path                 | Body / query                                                              | Success                                                                       | Error codes                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /games/{id}/uploads`      | `{ kind: "build"\|"screenshot"\|"video"\|"cover", filename, size, mime }` | `201 { uploadId, url, method: "PUT", headers, fields: {}, expiresAt, media }` | `UNAUTHENTICATED`, `FORBIDDEN`, `GAME_NOT_FOUND`, `INVALID_UPLOAD` (bad extension, MIME or size), `UPLOAD_LIMIT_REACHED` |
| `POST /users/me/uploads`        | `{ kind: "avatar", filename, size, mime }`                                | same as above                                                                 | same                                                                                                                     |
| `POST /uploads/{id}/complete`   | –                                                                         | `200 { media }` (status becomes `scanning` or `processing`)                   | `UPLOAD_NOT_FOUND`, `UPLOAD_NOT_RECEIVED`, `UPLOAD_REJECTED`, `INVALID_STATE`                                            |
| `GET /uploads/{id}`             | –                                                                         | `200 { media }`                                                               | `UPLOAD_NOT_FOUND`                                                                                                       |
| `DELETE /media/{id}`            | –                                                                         | `204`                                                                         | `UPLOAD_NOT_FOUND`, `FORBIDDEN`                                                                                          |
| `PATCH /games/{id}/media/order` | `{ mediaIds: string[] }` (screenshots, in the new order)                  | `200 { items: Media[] }`                                                      | `FORBIDDEN`, `GAME_NOT_FOUND`, `INVALID_UPLOAD`                                                                          |
| `GET /games/{id}/download`      | `?mediaId=` optional (a specific build)                                   | `302` to a presigned URL valid for 5 minutes                                  | `GAME_NOT_FOUND`, `BUILD_NOT_AVAILABLE`                                                                                  |

Note on `url` / `method` / `fields`: PLAN.md §3.2 sketched `{uploadId, url, fields}` (a presigned
POST). Cloudflare R2, our production storage, does not support presigned POST policies, so the
upload is a **presigned PUT**: the browser sends the raw file with `method` to `url` with the given
`headers`. `fields` is always `{}` and only kept so the shape stays compatible. The client then calls
`POST /uploads/{id}/complete`. `uploadId` is the `media.id`.

`Media` object:

```jsonc
{
  "id": "uuid",
  "gameId": "uuid | null",
  "kind": "build | screenshot | video | cover | avatar",
  "originalName": "trailer.mp4",
  "mime": "video/mp4",
  "sizeBytes": 12345,
  "status": "uploading | scanning | processing | ready | rejected",
  "rejectReason": "string | null", // set when status = rejected
  "sortOrder": 0,
  "variants": {
    // images (screenshot, cover, avatar): WebP files
    "thumb": { "url": "…", "width": 320, "height": 180 },
    "card": { "url": "…", "width": 640, "height": 360 },
    "full": { "url": "…", "width": 1600, "height": 900 },
    // video
    "mp4_720p": { "url": "…", "width": 1280, "height": 720, "durationSec": 31.4 },
    "poster": { "url": "…", "width": 1280, "height": 720 },
    // builds have no variants; they are downloaded through GET /games/{id}/download
  },
  "createdAt": "2026-10-06T12:00:00.000Z",
}
```

Limits (also enforced by the plugin): build ≤ 2 GB (`.zip .exe .dmg .apk .AppImage .tar.gz .tgz`),
video ≤ 300 MB (`.mp4 .mov .webm`), images ≤ 10 MB (`.png .jpg .jpeg .webp .gif`). Per game: one
cover and one video (a new upload replaces the old one), up to 12 screenshots, up to 8 builds.
