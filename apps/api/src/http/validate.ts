import { z } from 'zod';
import { invalid, notFound } from '../errors.ts';
import { stripHtml } from './text.ts';

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    throw invalid(details[0] ? `${details[0].path || 'body'}: ${details[0].message}` : 'Invalid input', details);
  }
  return result.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): boolean => typeof s === 'string' && UUID_RE.test(s);

/** A malformed id can never exist, so it is a 404 rather than a validation error. */
export function uuidParam(value: unknown, what = 'Resource'): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw notFound(what);
  return value.toLowerCase();
}

/** Trimmed, HTML-stripped string with length limits applied after cleaning. */
export const text = (min: number, max: number) =>
  z
    .string()
    .transform((s) => stripHtml(s).trim())
    .pipe(z.string().min(min).max(max));

/** Optional free text that may be empty. */
export const optionalText = (max: number) => text(0, max);
