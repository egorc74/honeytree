import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { Queue } from 'bullmq';
import {
  BullJobQueue,
  QUEUES,
  S3Storage,
  createRedisConnection,
  loadMediaConfig,
} from '@honeytree/media/core';
import { ClamavScanner } from './clamav';
import type { WorkerContext } from './context';
import { scheduleMaintenance, startWorkers } from './jobs';
import { logger } from './log';
import { captureError, flushSentry, initSentry } from './sentry';

async function main() {
  initSentry();
  const config = loadMediaConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const connection = createRedisConnection(config.redisUrl);

  const ctx: WorkerContext = {
    db: pool,
    storage: new S3Storage(config.s3),
    queue: new BullJobQueue(connection),
    scanner: new ClamavScanner(config.clamav),
    log: logger,
    tmpDir: await mkdtemp(join(tmpdir(), 'honeytree-worker-')),
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    now: () => new Date(),
  };

  const maintenance = new Queue(QUEUES.maintenance, { connection });
  await scheduleMaintenance(maintenance);
  const workers = startWorkers(ctx, connection);
  logger.info('worker started');

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    await workers.close();
    await maintenance.close();
    await ctx.queue.close();
    await connection.quit();
    await pool.end();
    await flushSentry();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown(signal));
}

main().catch(async (err) => {
  logger.error('worker crashed on startup', { error: String(err) });
  captureError(err);
  await flushSentry();
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error('unhandled rejection', { error: String(err) });
  captureError(err);
});
