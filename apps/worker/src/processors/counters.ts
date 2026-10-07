import type { WorkerContext } from '../context';

/**
 * The cached counters and what they must equal. These definitions are the contract with
 * Agent 1's transactional updates: see docs/requests/agent3-to-agent1-counter-definitions.md.
 */
interface CounterSpec {
  name: string;
  table: string;
  column: string;
  /** SQL for the true value, written against the row alias `t`. */
  expr: string;
  float?: boolean;
}

export const COUNTER_SPECS: CounterSpec[] = [
  {
    name: 'games.likes_count',
    table: 'games',
    column: 'likes_count',
    expr: '(SELECT count(*)::int FROM game_likes x WHERE x.game_id = t.id)',
  },
  {
    name: 'games.comments_count',
    table: 'games',
    column: 'comments_count',
    expr: '(SELECT count(*)::int FROM comments x WHERE x.game_id = t.id AND x.deleted_at IS NULL)',
  },
  {
    name: 'games.reviews_count',
    table: 'games',
    column: 'reviews_count',
    expr: '(SELECT count(*)::int FROM reviews x WHERE x.game_id = t.id)',
  },
  {
    name: 'games.rating_avg',
    table: 'games',
    column: 'rating_avg',
    expr: '(SELECT COALESCE(avg(x.rating), 0)::float8 FROM reviews x WHERE x.game_id = t.id)',
    float: true,
  },
  {
    name: 'games.downloads_count',
    table: 'games',
    column: 'downloads_count',
    expr: '(SELECT count(*)::int FROM downloads x WHERE x.game_id = t.id)',
  },
  {
    name: 'comments.likes_count',
    table: 'comments',
    column: 'likes_count',
    expr: '(SELECT count(*)::int FROM comment_likes x WHERE x.comment_id = t.id)',
  },
  {
    name: 'users.karma_total',
    table: 'users',
    column: 'karma_total',
    expr: '(SELECT COALESCE(sum(x.amount), 0)::int FROM karma_events x WHERE x.user_id = t.id)',
  },
  {
    name: 'users.games_count',
    table: 'users',
    column: 'games_count',
    expr: "(SELECT count(*)::int FROM games x WHERE x.owner_id = t.id AND x.status = 'published')",
  },
  {
    name: 'users.likes_received_total',
    table: 'users',
    column: 'likes_received_total',
    expr: `(SELECT count(*)::int FROM game_likes l JOIN games x ON x.id = l.game_id
             WHERE x.owner_id = t.id AND x.status = 'published' AND l.user_id <> t.id)`,
  },
  {
    name: 'users.rating_count',
    table: 'users',
    column: 'rating_count',
    expr: `(SELECT count(*)::int FROM reviews r JOIN games x ON x.id = r.game_id
             WHERE x.owner_id = t.id AND x.status = 'published' AND r.user_id <> t.id)`,
  },
  {
    name: 'users.rating_avg',
    table: 'users',
    column: 'rating_avg',
    expr: `(SELECT COALESCE(avg(r.rating), 0)::float8 FROM reviews r JOIN games x ON x.id = r.game_id
             WHERE x.owner_id = t.id AND x.status = 'published' AND r.user_id <> t.id)`,
    float: true,
  },
];

export type CounterMode = 'fix' | 'report';

/** Rows whose cached value differs from the truth, per counter. */
export type CounterDrift = Record<string, number>;

const differs = (s: CounterSpec) =>
  s.float
    ? `abs(COALESCE(t.${s.column}, 0)::float8 - ${s.expr}) > 0.000001`
    : `t.${s.column} IS DISTINCT FROM ${s.expr}`;

/**
 * Nightly job: finds cached counters that drifted from the real rows and, in `fix` mode,
 * repairs them. In `report` mode it only counts and logs. Returns the drift per counter.
 */
export async function recheckCounters(
  ctx: WorkerContext,
  mode: CounterMode = 'fix',
): Promise<CounterDrift> {
  const drift: CounterDrift = {};
  for (const spec of COUNTER_SPECS) {
    if (mode === 'fix') {
      const { rows } = await ctx.db.query(
        `UPDATE ${spec.table} t SET ${spec.column} = ${spec.expr} WHERE ${differs(spec)} RETURNING 1 AS fixed`,
      );
      drift[spec.name] = rows.length;
    } else {
      const { rows } = await ctx.db.query<{ n: number | string }>(
        `SELECT count(*) AS n FROM ${spec.table} t WHERE ${differs(spec)}`,
      );
      drift[spec.name] = Number(rows[0]?.n ?? 0);
    }
  }
  const drifted = Object.fromEntries(Object.entries(drift).filter(([, n]) => n > 0));
  if (Object.keys(drifted).length > 0) {
    ctx.log.warn(`counter drift ${mode === 'fix' ? 'fixed' : 'found'}`, { mode, drifted });
  } else {
    ctx.log.info('counters consistent');
  }
  return drift;
}
