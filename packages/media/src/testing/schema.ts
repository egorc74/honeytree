/**
 * A minimal copy of the tables from PLAN.md §3.1 that Agent 3's code touches, with the
 * conventions requested in docs/requests/agent3-to-agent1-database-contract.md.
 * Used by unit tests (PGlite) so they do not depend on Agent 1's Prisma migration.
 * The real schema is checked by `pnpm --filter @honeytree/worker check:schema`.
 */
export const TEST_SCHEMA_SQL = `
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL DEFAULT 'x',
  role text NOT NULL DEFAULT 'user',
  avatar_media_id uuid,
  karma_total integer NOT NULL DEFAULT 0,
  likes_received_total integer NOT NULL DEFAULT 0,
  games_count integer NOT NULL DEFAULT 0,
  rating_avg double precision NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  cover_media_id uuid,
  likes_count integer NOT NULL DEFAULT 0,
  downloads_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  reviews_count integer NOT NULL DEFAULT 0,
  rating_avg double precision NOT NULL DEFAULT 0,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'uploading',
  variants jsonb NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_likes (
  user_id uuid NOT NULL REFERENCES users(id),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  rating integer NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid,
  kind text NOT NULL DEFAULT 'comment',
  body text NOT NULL DEFAULT '',
  accepted_at timestamptz,
  likes_count integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE comment_likes (
  user_id uuid NOT NULL REFERENCES users(id),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, comment_id)
);

CREATE TABLE karma_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  amount integer NOT NULL,
  reason text NOT NULL,
  ref_type text,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id uuid,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_scores (
  game_id uuid PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  fresh_score double precision NOT NULL DEFAULT 0,
  loved_score double precision NOT NULL DEFAULT 0,
  rising_score double precision NOT NULL DEFAULT 0,
  engagement_24h double precision NOT NULL DEFAULT 0,
  engagement_7d double precision NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);
`;
