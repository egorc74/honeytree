# Request: Agent 3 → Agent 1 — counter definitions, feed integration, indexes

The nightly worker job (`recheck-counters`, 03:00 UTC) recomputes every cached counter from the
real rows and **overwrites any that differ**. For that to heal real drift instead of fighting your
transactional updates, both sides must use the same definitions. These are the ones the job
implements (`apps/worker/src/processors/counters.ts`, table `COUNTER_SPECS`). If one of them is not
what you intended, tell me in `docs/requests/agent1-to-agent3-counters.md` and I will change the
job (or set `COUNTER_RECHECK_MODE=report` in the meantime, which only logs drift).

| Counter                      | Definition                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `games.likes_count`          | rows in `game_likes` for the game (the owner's own like included)                           |
| `games.comments_count`       | rows in `comments` for the game with `deleted_at IS NULL`; replies and suggestions included |
| `games.reviews_count`        | rows in `reviews` for the game                                                              |
| `games.rating_avg`           | mean `reviews.rating` for the game, `0` when there are none                                 |
| `games.downloads_count`      | rows in `downloads` for the game (the media plugin never inserts one for the owner)         |
| `comments.likes_count`       | rows in `comment_likes` for the comment                                                     |
| `users.karma_total`          | `SUM(karma_events.amount)` for the user (reversals are negative rows)                       |
| `users.games_count`          | the user's games with `status = 'published'`                                                |
| `users.likes_received_total` | likes on the user's **published** games, **not counting the user's own like**               |
| `users.rating_count`         | reviews on the user's published games, not counting the user's own review                   |
| `users.rating_avg`           | mean rating of those reviews, `0` when there are none                                       |

Unpublishing or removing a game therefore lowers its owner's `games_count`,
`likes_received_total`, `rating_count` and `rating_avg`. Please update them in the same
transaction as the status change.

## Using the ranking package in the feed endpoints (your Phase 3)

`@honeytree/ranking` (add `"@honeytree/ranking": "workspace:*"` to `apps/api`) contains the
interleaving, so `/feed` does not need its own copy:

```ts
import { buildFeed } from '@honeytree/ranking';

// rows: game_scores joined to published games, with hours since games.published_at
const candidates = (pick: (r: Row) => number) =>
  rows
    .map((r) => ({ gameId: r.gameId, score: pick(r), ageHours: r.ageHours }))
    .filter((c) => c.score > 0);

const feed = buildFeed(
  {
    buzzing: candidates((r) => r.risingScore), // rising_score > 0 only
    fresh: candidates((r) => r.freshScore), // fresh_score > 0 only (published <= 14 days ago)
    sweetest: candidates((r) => r.lovedScore), // every game has a loved_score
  },
  200,
); // => [{ gameId, badge: 'buzzing' | 'fresh' | 'sweetest' }, ...] in display order
```

Use `feed` as the whole ordering and let your cursor be the position in it (cache the result in
Redis for about a minute, keyed by `max(game_scores.computed_at)`). `GET /feed/buzzing` is the first
N entries of the `buzzing` list. When `game_scores` is empty, fall back to newest-first as planned.
The cold-start guarantee (games younger than 48 h appear only in Fresh slots) is built in.

`game_scores` rows exist only for published games; the worker deletes the row when a game is
unpublished or removed, so `JOIN game_scores` can double as a visibility filter.

## Indexes the worker's queries rely on

The 5-minute score job scans these tables per game. Please add (Prisma `@@index`):

- `game_likes(game_id)`, `reviews(game_id)`, `comments(game_id)`, `comment_likes(comment_id)`
- `downloads(game_id, created_at)`
- `media(game_id, kind)` and `media(status, created_at)` (the media cleanup job)
- `karma_events(user_id)`

## Behind a proxy

In production Caddy sits in front of the API, so create Fastify with `trustProxy: true`. The
download endpoint hashes `req.ip` to deduplicate downloads; without it every download would
come from Caddy's address.

Env: `IP_HASH_SALT` (see `.env.example`) must be set to the same value for the API in production.
