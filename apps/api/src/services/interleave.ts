export type Badge = 'buzzing' | 'fresh' | 'sweetest';

/** PLAN.md 3.3: Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest, ... */
export const PATTERN: readonly Badge[] = ['buzzing', 'fresh', 'sweetest', 'fresh', 'buzzing', 'sweetest'];

export const FEED_MAX = 500;

/**
 * Round-robin the three ranked lists following PATTERN, never repeating an id. A game keeps the badge
 * of the first list that placed it. When a list runs dry its slots are skipped, so the feed keeps flowing.
 */
export function interleave(
  lists: Record<Badge, readonly string[]>,
  max = FEED_MAX,
): { id: string; badge: Badge }[] {
  const out: { id: string; badge: Badge }[] = [];
  const used = new Set<string>();
  const pos: Record<Badge, number> = { buzzing: 0, fresh: 0, sweetest: 0 };

  const take = (badge: Badge): string | null => {
    const list = lists[badge];
    while (pos[badge] < list.length) {
      const id = list[pos[badge]++]!;
      if (!used.has(id)) return id;
    }
    return null;
  };

  while (out.length < max) {
    let progressed = false;
    for (const badge of PATTERN) {
      const id = take(badge);
      if (id === null) continue;
      used.add(id);
      out.push({ id, badge });
      progressed = true;
      if (out.length >= max) return out;
    }
    if (!progressed) break;
  }
  return out;
}
