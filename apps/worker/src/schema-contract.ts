import type { Db } from '@honeytree/media/core';

/**
 * Every column Agent 3's code (worker + media plugin) reads or writes, with the kind of type
 * it expects. See docs/requests/agent3-to-agent1-database-contract.md.
 */
type Kind = 'uuid' | 'text' | 'int' | 'bigint' | 'float' | 'jsonb' | 'timestamptz' | 'bool';

export const REQUIRED_COLUMNS: Record<string, Record<string, Kind>> = {
  users: {
    id: 'uuid',
    role: 'text',
    avatar_media_id: 'uuid',
    karma_total: 'int',
    likes_received_total: 'int',
    games_count: 'int',
    rating_avg: 'float',
    rating_count: 'int',
  },
  games: {
    id: 'uuid',
    owner_id: 'uuid',
    status: 'text',
    cover_media_id: 'uuid',
    published_at: 'timestamptz',
    created_at: 'timestamptz',
    likes_count: 'int',
    downloads_count: 'int',
    comments_count: 'int',
    reviews_count: 'int',
    rating_avg: 'float',
  },
  media: {
    id: 'uuid',
    game_id: 'uuid',
    owner_id: 'uuid',
    kind: 'text',
    storage_key: 'text',
    original_name: 'text',
    mime: 'text',
    size_bytes: 'bigint',
    status: 'text',
    variants: 'jsonb',
    sort_order: 'int',
    created_at: 'timestamptz',
  },
  game_likes: { user_id: 'uuid', game_id: 'uuid', created_at: 'timestamptz' },
  reviews: {
    id: 'uuid',
    game_id: 'uuid',
    user_id: 'uuid',
    rating: 'int',
    created_at: 'timestamptz',
  },
  comments: {
    id: 'uuid',
    game_id: 'uuid',
    user_id: 'uuid',
    deleted_at: 'timestamptz',
    likes_count: 'int',
    created_at: 'timestamptz',
  },
  comment_likes: { user_id: 'uuid', comment_id: 'uuid' },
  karma_events: { user_id: 'uuid', amount: 'int' },
  downloads: {
    id: 'uuid',
    game_id: 'uuid',
    user_id: 'uuid',
    ip_hash: 'text',
    created_at: 'timestamptz',
  },
  game_scores: {
    game_id: 'uuid',
    fresh_score: 'float',
    loved_score: 'float',
    rising_score: 'float',
    engagement_24h: 'float',
    engagement_7d: 'float',
    computed_at: 'timestamptz',
  },
};

const ACCEPTED: Record<Kind, string[]> = {
  uuid: ['uuid'],
  text: ['text', 'character varying', 'USER-DEFINED'],
  int: ['integer', 'bigint', 'smallint'],
  bigint: ['bigint'],
  float: ['double precision', 'numeric', 'real'],
  jsonb: ['jsonb'],
  timestamptz: ['timestamp with time zone'],
  bool: ['boolean'],
};

export interface SchemaProblem {
  table: string;
  column?: string;
  problem: string;
}

/** Compares a live database with what Agent 3's code expects. An empty list means compatible. */
export async function checkSchema(db: Db): Promise<SchemaProblem[]> {
  const { rows } = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = current_schema()`,
  );
  const actual = new Map<string, Map<string, string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Map());
    actual.get(r.table_name)!.set(r.column_name, r.data_type);
  }

  const problems: SchemaProblem[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const have = actual.get(table);
    if (!have) {
      problems.push({ table, problem: 'table is missing' });
      continue;
    }
    for (const [column, kind] of Object.entries(columns)) {
      const type = have.get(column);
      if (!type) problems.push({ table, column, problem: `column is missing (expected ${kind})` });
      else if (!ACCEPTED[kind].includes(type)) {
        problems.push({ table, column, problem: `is ${type}, expected ${kind}` });
      }
    }
  }

  // game_scores must be upsertable by game_id.
  const pk = await db.query<{ column_name: string }>(
    `SELECT kcu.column_name FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu USING (constraint_name, table_schema)
     WHERE tc.table_schema = current_schema() AND tc.table_name = 'game_scores'
       AND tc.constraint_type = 'PRIMARY KEY'`,
  );
  if (
    actual.has('game_scores') &&
    !(pk.rows.length === 1 && pk.rows[0]!.column_name === 'game_id')
  ) {
    problems.push({ table: 'game_scores', column: 'game_id', problem: 'must be the primary key' });
  }
  return problems;
}
