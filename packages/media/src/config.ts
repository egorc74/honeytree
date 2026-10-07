import { z } from 'zod';
import type { S3StorageConfig } from './storage';

const boolish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().optional(),
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolish.default(true),
  S3_BUCKET_PRIVATE: z.string().min(1).default('honeytree-private'),
  S3_BUCKET_PUBLIC: z.string().min(1).default('honeytree-public'),
  S3_PUBLIC_BASE_URL: z.string().min(1),
  IP_HASH_SALT: z.string().min(1).default('dev-only-salt'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().default(3310),
});

export interface MediaConfig {
  databaseUrl: string;
  redisUrl: string;
  s3: S3StorageConfig;
  ipHashSalt: string;
  clamav: { host: string; port: number };
}

/** Reads and validates the environment variables listed in `.env.example`. */
export function loadMediaConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid media configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    ipHashSalt: e.IP_HASH_SALT,
    clamav: { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT },
    s3: {
      endpoint: e.S3_ENDPOINT || undefined,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT || undefined,
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      bucketPrivate: e.S3_BUCKET_PRIVATE,
      bucketPublic: e.S3_BUCKET_PUBLIC,
      publicBaseUrl: e.S3_PUBLIC_BASE_URL,
    },
  };
}
