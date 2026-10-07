import type { Db } from '../db.ts';

/** Karma goes to the user who performs the action (PLAN.md 1.7). */
export const KARMA_AMOUNTS = {
  like_game: 1,
  like_comment: 1,
  comment: 2,
  suggestion: 3,
  review: 3,
  suggestion_accepted: 10,
} as const;

export type KarmaAction = keyof typeof KARMA_AMOUNTS;

export const DAILY_CAP_LIKES = 50;
export const DAILY_CAP_TOTAL = 100;

const LIKE_REASONS: ReadonlySet<string> = new Set(['like_game', 'like_comment']);

export type KarmaKey = {
  userId: string;
  reason: KarmaAction;
  refType: 'game' | 'comment' | 'review';
  refId: string;
};

const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

/** Serialise karma writes per user so two parallel requests cannot both slip under a cap. */
const lockUser = (tx: Db, userId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'karma:' + userId}))`;

/** The not-yet-reversed ledger row for this action, if any. */
async function findOpenEvent(tx: Db, key: KarmaKey) {
  const rows = await tx.$queryRaw<{ id: string; amount: number }[]>`
    SELECT e.id, e.amount
    FROM karma_events e
    WHERE e.user_id = ${key.userId}::uuid
      AND e.reason = ${key.reason}::"KarmaReason"
      AND e.ref_type = ${key.refType}
      AND e.ref_id = ${key.refId}::uuid
      AND NOT EXISTS (SELECT 1 FROM karma_events r WHERE r.reverses_id = e.id)
    LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * Karma earned so far today (UTC). A reversal counts against the day and reason of the event it
 * reverses, so "like → unlike → like" cannot be used to farm points or to dodge the cap.
 */
async function usageToday(tx: Db, userId: string) {
  const rows = await tx.$queryRaw<{ reason: string; amt: bigint }[]>`
    SELECT COALESCE(o.reason, e.reason)::text AS reason, SUM(e.amount) AS amt
    FROM karma_events e
    LEFT JOIN karma_events o ON o.id = e.reverses_id
    WHERE e.user_id = ${userId}::uuid
      AND (CASE WHEN e.reverses_id IS NULL THEN e.created_at ELSE o.created_at END) >= ${startOfUtcDay()}
    GROUP BY 1`;
  let likes = 0;
  let total = 0;
  for (const r of rows) {
    const amt = Number(r.amt);
    total += amt;
    if (LIKE_REASONS.has(r.reason)) likes += amt;
  }
  return { likes, total };
}

/**
 * Grant karma for an action. Idempotent per (user, reason, ref) until reversed.
 * Returns the amount actually awarded (0 when already awarded or capped).
 * Callers decide about self-action exclusion *before* calling this.
 */
export async function awardKarma(tx: Db, key: KarmaKey): Promise<number> {
  await lockUser(tx, key.userId);
  if (await findOpenEvent(tx, key)) return 0;

  const usage = await usageToday(tx, key.userId);
  const room = Math.min(
    LIKE_REASONS.has(key.reason) ? DAILY_CAP_LIKES - usage.likes : Infinity,
    DAILY_CAP_TOTAL - usage.total,
  );
  const awarded = Math.min(KARMA_AMOUNTS[key.reason], room);
  if (awarded <= 0) return 0;

  await tx.karmaEvent.create({
    data: { userId: key.userId, amount: awarded, reason: key.reason, refType: key.refType, refId: key.refId },
  });
  await tx.user.update({ where: { id: key.userId }, data: { karmaTotal: { increment: awarded } } });
  return awarded;
}

/** Undo a previous award. Returns the (negative) amount removed, 0 if there was nothing to undo. */
export async function revokeKarma(tx: Db, key: KarmaKey): Promise<number> {
  await lockUser(tx, key.userId);
  const event = await findOpenEvent(tx, key);
  if (!event) return 0;

  await tx.karmaEvent.create({
    data: {
      userId: key.userId,
      amount: -event.amount,
      reason: 'reversal',
      refType: key.refType,
      refId: key.refId,
      reversesId: event.id,
    },
  });
  await tx.user.update({ where: { id: key.userId }, data: { karmaTotal: { decrement: event.amount } } });
  return -event.amount;
}
