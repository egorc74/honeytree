import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  // Empty string means "no Redis": caching is skipped and rate limits are kept in memory.
  REDIS_URL: z.string().default(''),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // Same bucket URL the media plugin/worker use (S3_PUBLIC_BASE_URL); MEDIA_PUBLIC_BASE_URL overrides it for the API only.
  MEDIA_PUBLIC_BASE_URL: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  // `false` runs the API without uploads/downloads (no MinIO/Redis/S3 credentials needed).
  MEDIA_ENABLED: bool.default(true),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_ENABLED: bool.default(true),
  COOKIE_SECURE: bool.optional(),
});

const env = schema.parse(process.env);

const stripSlash = (s: string) => s.replace(/\/+$/, '');

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  port: env.PORT,
  host: env.HOST,
  webOrigins: env.WEB_ORIGINS.split(',').map((s) => stripSlash(s.trim())).filter(Boolean),
  apiPublicUrl: stripSlash(env.API_PUBLIC_URL),
  mediaPublicBaseUrl: stripSlash(env.MEDIA_PUBLIC_BASE_URL ?? env.S3_PUBLIC_BASE_URL ?? 'http://localhost:9000/honeytree-public'),
  sessionTtlMs: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  rateLimitEnabled: env.RATE_LIMIT_ENABLED,
  mediaEnabled: env.MEDIA_ENABLED,
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
};

export type Config = typeof config;
