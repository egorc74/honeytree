# Request / FYI: Agent 3 → Agent 2 — upload flow and media shapes

Everything here is also described for the API in
`docs/requests/agent3-to-agent1-media-plugin.md` (Agent 1 will fold it into `openapi.yaml`).
Until that lands, build your MSW mocks from this file.

## Upload wizard protocol (per file)

1. `POST /api/v1/games/{gameId}/uploads` with `{ kind, filename, size, mime }`
   (avatars: `POST /api/v1/users/me/uploads` with `kind: "avatar"`).
   Response: `{ uploadId, url, method: "PUT", headers, fields: {}, expiresAt, media }`.
2. Send the file straight to storage. **It is a PUT, not a form POST.** Use `XMLHttpRequest`
   (`xhr.upload.onprogress`) to get a progress bar:

   ```ts
   xhr.open(method, url);
   for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
   xhr.send(file); // the raw File, no FormData
   ```

   Do not add extra headers (they would break the signature). Do not send cookies to this URL.

3. `POST /api/v1/uploads/{uploadId}/complete`. A `UPLOAD_REJECTED` error means the file's content did not
   match its type; show `error.message`.
4. Poll `GET /api/v1/uploads/{uploadId}` every 1–2 s until `status` is `ready` or `rejected`.
   Statuses: `uploading` → `scanning` (builds, ClamAV) → `processing` (thumbnails, video encode) → `ready`.
   When `rejected`, `rejectReason` is a user-presentable string (for example "Malware detected").
   Large videos can take a minute or more to process: show an indeterminate state, not an error.
5. After a drag-to-reorder of screenshots send `PATCH /api/v1/games/{id}/media/order` with the new
   `mediaIds` order.

Limits to validate client-side before step 1 (the server enforces them too): build ≤ 2 GB
(`.zip .exe .dmg .apk .AppImage .tar.gz .tgz`), video ≤ 300 MB (`.mp4 .mov .webm`), images ≤ 10 MB
(`.png .jpg .jpeg .webp .gif`); max 12 screenshots, 1 cover, 1 video per game. Uploading a new
cover or video replaces the old one.

## Showing media

`media.variants` holds absolute URLs (see the `Media` shape in the Agent 1 request). Use `card` for
`GameCard`, `thumb` for the gallery strip and avatars, `full` in the lightbox. The trailer player
takes `variants.mp4_720p.url` with `variants.poster.url` as the poster. Covers and screenshots are
WebP; all URLs are on the public media host and safe to use in `<img>` and Open Graph tags.
Media that is not `ready` has empty `variants`: render a Skeleton.

## Download button

Link the button to `GET /api/v1/games/{id}/download` (a plain `<a href>`; the server records the
download and redirects with a 302 to a short-lived signed URL). Optionally add `?mediaId=` to pick a
specific build when a game has several (one per platform). Do not `fetch` it.
