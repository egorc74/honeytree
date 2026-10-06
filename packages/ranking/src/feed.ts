import { DEFAULT_CONFIG, type FeedBadge, type RankingConfig } from './config';

export interface FeedCandidate {
  gameId: string;
  /** Hours since publication (used for the cold-start rule). */
  ageHours: number;
  score: number;
}

export interface FeedLists {
  buzzing: FeedCandidate[];
  fresh: FeedCandidate[];
  sweetest: FeedCandidate[];
}

export interface FeedItem {
  gameId: string;
  badge: FeedBadge;
}

const byScoreDesc = (a: FeedCandidate, b: FeedCandidate) =>
  b.score - a.score || a.ageHours - b.ageHours || a.gameId.localeCompare(b.gameId);

/**
 * Builds the mixed feed: walks the slot pattern (Buzzing, Fresh, Sweetest, Fresh, Buzzing,
 * Sweetest, …) and takes the best game from that slot's list that has not appeared yet.
 * An exhausted list yields its slot to the next list in the pattern order, so the feed only
 * ends when every list is empty.
 *
 * Cold start: a game younger than `feed.coldStartHours` is only eligible for the Fresh slots,
 * so a new game can never be "used up" by another list or fall out of the front of the feed.
 * Each item carries the badge of the list it came from.
 */
export function buildFeed(
  lists: FeedLists,
  limit: number,
  cfg: RankingConfig = DEFAULT_CONFIG,
): FeedItem[] {
  const cold = (c: FeedCandidate) => c.ageHours < cfg.feed.coldStartHours;
  const queues: Record<FeedBadge, FeedCandidate[]> = {
    fresh: [...lists.fresh].sort(byScoreDesc),
    buzzing: lists.buzzing.filter((c) => !cold(c)).sort(byScoreDesc),
    sweetest: lists.sweetest.filter((c) => !cold(c)).sort(byScoreDesc),
  };
  const used = new Set<string>();
  const next = (badge: FeedBadge): FeedCandidate | undefined => {
    const queue = queues[badge];
    while (queue.length > 0) {
      const candidate = queue.shift()!;
      if (!used.has(candidate.gameId)) return candidate;
    }
    return undefined;
  };

  const items: FeedItem[] = [];
  const pattern = cfg.feed.pattern;
  for (let slot = 0; items.length < limit; slot++) {
    // Try the slot's own list first, then the other lists in pattern order.
    const order = [...new Set([pattern[slot % pattern.length]!, ...pattern])];
    let placed = false;
    for (const badge of order) {
      const candidate = next(badge);
      if (candidate) {
        used.add(candidate.gameId);
        items.push({ gameId: candidate.gameId, badge });
        placed = true;
        break;
      }
    }
    if (!placed) break; // every list is empty
  }
  return items;
}
