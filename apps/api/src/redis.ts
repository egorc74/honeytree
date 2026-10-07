import { Redis } from 'ioredis';
import { config } from './config.ts';

let client: Redis | null | undefined;

/** Lazily created Redis client, or null when REDIS_URL is not set. */
export function getRedis(): Redis | null {
  if (client !== undefined) return client;
  if (!config.redisUrl) return (client = null);
  client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  client.on('error', () => {
    /* cache is best-effort: errors are handled per call */
  });
  return client;
}

export async function closeRedis() {
  if (client) await client.quit().catch(() => undefined);
  client = undefined;
}

/**
 * Best-effort JSON cache. Falls through to `fn` when Redis is missing or failing,
 * so the API works (just slower) without it.
 */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return fn();
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    return fn();
  }
  const value = await fn();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
  return value;
}

/** Drop cached entries after a write that changes what they hold (best effort). */
export async function invalidate(...keys: string[]) {
  const redis = getRedis();
  if (!redis || !keys.length) return;
  try {
    await redis.del(...keys);
  } catch {
    /* ignore: entries expire on their own */
  }
}

export const FEED_SEQUENCE_KEY = 'feed:seq:v1';
