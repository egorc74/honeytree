import type { QueryClient } from "@tanstack/react-query";

/**
 * Optimistic updates across every cached list that may contain an entity
 * (feed pages, search results, profile lists, leaderboard, game page…).
 * Walks cached data and patches any object matching `match`, preserving
 * referential identity where nothing changed.
 */
export function mapDeep(value: unknown, match: (o: Record<string, unknown>) => boolean, patch: (o: any) => any): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((v) => {
      const n = mapDeep(v, match, patch);
      if (n !== v) changed = true;
      return n;
    });
    return changed ? next : value;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    let out: Record<string, unknown> = obj;
    if (match(obj)) out = { ...obj, ...patch(obj) };
    let changed = out !== obj;
    const result: Record<string, unknown> = { ...out };
    for (const [k, v] of Object.entries(out)) {
      if (v && typeof v === "object") {
        const n = mapDeep(v, match, patch);
        if (n !== v) {
          result[k] = n;
          changed = true;
        }
      }
    }
    return changed ? result : value;
  }
  return value;
}

const isGame = (id: string) => (o: Record<string, unknown>) => o.id === id && "likesCount" in o && "slug" in o;
const isComment = (id: string) => (o: Record<string, unknown>) => o.id === id && "likesCount" in o && "kind" in o && "gameId" in o;

export function patchGame(qc: QueryClient, id: string, patch: (g: any) => Record<string, unknown>) {
  qc.setQueriesData({ predicate: (q) => q.queryKey[0] !== "me" }, (data: unknown) => (data ? mapDeep(data, isGame(id), patch) : data));
}

export function patchComment(qc: QueryClient, id: string, patch: (c: any) => Record<string, unknown>) {
  qc.setQueriesData({ queryKey: ["comments"] }, (data: unknown) => (data ? mapDeep(data, isComment(id), patch) : data));
}

type Snapshot = [readonly unknown[], unknown][];

/** Snapshot every cached query (except `me`) so an optimistic update can be rolled back. */
export function snapshotQueries(qc: QueryClient): Snapshot {
  return qc.getQueriesData({ predicate: (q) => q.queryKey[0] !== "me" }).map(([key, data]) => [key, data]);
}

export function restoreQueries(qc: QueryClient, snap: Snapshot) {
  for (const [key, data] of snap) qc.setQueryData(key, data);
}
