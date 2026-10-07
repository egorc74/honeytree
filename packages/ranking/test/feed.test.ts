import { describe, expect, it } from 'vitest';
import { buildFeed, type FeedCandidate, type FeedLists } from '../src';

const c = (gameId: string, score: number, ageHours = 24 * 30): FeedCandidate => ({
  gameId,
  score,
  ageHours,
});

describe('buildFeed', () => {
  it('follows the pattern Buzzing, Fresh, Sweetest, Fresh, Buzzing, Sweetest', () => {
    const lists: FeedLists = {
      buzzing: [c('b1', 9), c('b2', 8), c('b3', 7)],
      fresh: [c('f1', 0.9, 100), c('f2', 0.8, 100), c('f3', 0.7, 100), c('f4', 0.6, 100)],
      sweetest: [c('s1', 5), c('s2', 4), c('s3', 3)],
    };
    const feed = buildFeed(lists, 12);
    expect(feed.map((i) => i.badge)).toEqual([
      ...['buzzing', 'fresh', 'sweetest', 'fresh', 'buzzing', 'sweetest'],
      ...['buzzing', 'fresh', 'sweetest', 'fresh'], // 10 games in total
    ]);
    expect(feed.map((i) => i.gameId).slice(0, 6)).toEqual(['b1', 'f1', 's1', 'f2', 'b2', 's2']);
  });

  it('orders each list by score and never repeats a game', () => {
    const lists: FeedLists = {
      buzzing: [c('x', 1), c('y', 9)],
      fresh: [c('y', 0.5, 100), c('z', 0.9, 100)],
      sweetest: [c('x', 4), c('w', 3)],
    };
    const feed = buildFeed(lists, 20);
    const ids = feed.map((i) => i.gameId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['w', 'x', 'y', 'z']);
    expect(buildFeed(lists, 1)[0]).toEqual({ gameId: 'y', badge: 'buzzing' }); // best buzzing first
  });

  it('gives an exhausted list’s slot to the other lists, and ends when all are empty', () => {
    const lists: FeedLists = {
      buzzing: [],
      fresh: [c('f1', 1, 100)],
      sweetest: [c('s1', 1), c('s2', 1)],
    };
    const feed = buildFeed(lists, 50);
    expect(feed).toHaveLength(3);
    expect(feed.map((i) => i.badge)).toEqual(['fresh', 'sweetest', 'sweetest']);
  });

  it('respects the limit and an empty input', () => {
    expect(buildFeed({ buzzing: [], fresh: [], sweetest: [] }, 10)).toEqual([]);
    const lists: FeedLists = {
      buzzing: [c('a', 1)],
      fresh: [c('b', 1, 100)],
      sweetest: [c('c', 1)],
    };
    expect(buildFeed(lists, 2)).toHaveLength(2);
  });

  it('cold start: games under 48 h only appear through the Fresh slots', () => {
    const lists: FeedLists = {
      // `new1` is both buzzing and sweetest, but only 5 hours old
      buzzing: [c('new1', 99, 5), c('old1', 10)],
      fresh: [c('new1', 0.99, 5), c('new2', 0.98, 10)],
      sweetest: [c('new1', 99, 5), c('old2', 5)],
    };
    const feed = buildFeed(lists, 10);
    const forNew = feed.filter((i) => i.gameId.startsWith('new'));
    expect(forNew.map((i) => i.badge)).toEqual(['fresh', 'fresh']);
    expect(feed.map((i) => i.gameId)).toContain('old1');
    expect(feed.map((i) => i.gameId)).toContain('old2');
    // new games land in the first fresh slots, i.e. positions 2 and 4
    expect(feed.findIndex((i) => i.gameId === 'new1')).toBeLessThan(4);
  });

  it('does not mutate its input', () => {
    const lists: FeedLists = { buzzing: [c('a', 1), c('b', 2)], fresh: [], sweetest: [] };
    buildFeed(lists, 5);
    expect(lists.buzzing.map((x) => x.gameId)).toEqual(['a', 'b']);
  });
});
