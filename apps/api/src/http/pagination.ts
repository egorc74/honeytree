import { z } from 'zod';
import { AppError } from '../errors.ts';

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed as T;
  } catch {
    /* fall through */
  }
  throw new AppError(400, 'INVALID_CURSOR', 'Invalid cursor');
}

export const pageQuery = (defaultLimit = 20, maxLimit = 50) =>
  z.object({
    cursor: z.string().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  });

/** Turn `limit + 1` fetched rows into a page and tell whether there is another one. */
export function slicePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
}
