import { Worker, type Job, type Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DEFAULT_JOB_OPTIONS, QUEUES, rejectMedia, type MediaJobData } from '@honeytree/media/core';
import type { WorkerContext } from './context';
import { cleanupMedia } from './processors/cleanup';
import { recheckCounters, type CounterMode } from './processors/counters';
import { computeScores } from './processors/scores';
import { processImage } from './processors/image';
import { scanMedia } from './processors/scan';
import { processVideo } from './processors/video';

/** Names of the repeatable jobs on the `maintenance` queue. */
export const MAINTENANCE_JOBS = {
  cleanupMedia: 'cleanup-media',
  computeScores: 'compute-scores',
  recheckCounters: 'recheck-counters',
} as const;

export async function runMaintenanceJob(ctx: WorkerContext, name: string): Promise<unknown> {
  switch (name) {
    case MAINTENANCE_JOBS.cleanupMedia:
      return cleanupMedia(ctx);
    case MAINTENANCE_JOBS.computeScores:
      return computeScores(ctx);
    case MAINTENANCE_JOBS.recheckCounters:
      return recheckCounters(ctx, (process.env.COUNTER_RECHECK_MODE as CounterMode) || 'fix');
    default:
      throw new Error(`Unknown maintenance job: ${name}`);
  }
}

/** Registers the repeatable maintenance jobs. Safe to call on every start. */
export async function scheduleMaintenance(queue: Queue): Promise<void> {
  await queue.upsertJobScheduler(
    MAINTENANCE_JOBS.cleanupMedia,
    { every: 60 * 60 * 1000 },
    { name: MAINTENANCE_JOBS.cleanupMedia },
  );
  // Plan: game_scores is recomputed every 5 minutes; counters are re-checked nightly (03:00 UTC).
  await queue.upsertJobScheduler(
    MAINTENANCE_JOBS.computeScores,
    { every: 5 * 60 * 1000 },
    { name: MAINTENANCE_JOBS.computeScores },
  );
  await queue.upsertJobScheduler(
    MAINTENANCE_JOBS.recheckCounters,
    { pattern: '0 3 * * *', tz: 'UTC' },
    { name: MAINTENANCE_JOBS.recheckCounters },
  );
  // Do not make the feed wait up to 5 minutes for its first scores after a (re)start.
  await queue.add(
    MAINTENANCE_JOBS.computeScores,
    {},
    { jobId: 'compute-scores-on-boot', removeOnComplete: true },
  );
}

export interface StartedWorkers {
  close(): Promise<void>;
}

/** Starts one BullMQ Worker per queue. Concurrency is low for the CPU-heavy video queue. */
export function startWorkers(ctx: WorkerContext, connection: Redis): StartedWorkers {
  const media = (name: string, concurrency: number, fn: (id: string) => Promise<void>) => {
    const worker = new Worker<MediaJobData>(name, (job) => fn(job.data.mediaId), {
      connection,
      concurrency,
    });
    worker.on('failed', (job, err) => void onFailed(ctx, job, err));
    return worker;
  };

  const workers = [
    media(QUEUES.scan, 2, (id) => scanMedia(ctx, id)),
    media(QUEUES.image, 4, (id) => processImage(ctx, id)),
    media(QUEUES.video, 1, (id) => processVideo(ctx, id)),
    new Worker(QUEUES.maintenance, (job) => runMaintenanceJob(ctx, job.name), {
      connection,
      concurrency: 1,
    }),
  ];
  for (const w of workers) {
    w.on('error', (err) => ctx.log.error('worker error', { queue: w.name, error: String(err) }));
  }
  return { close: async () => void (await Promise.all(workers.map((w) => w.close()))) };
}

/** When a media job has used up its retries, tell the uploader instead of leaving it spinning. */
async function onFailed(ctx: WorkerContext, job: Job<MediaJobData> | undefined, err: Error) {
  if (!job) return;
  const attempts = job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts;
  ctx.log.error('media job failed', {
    queue: job.queueName,
    mediaId: job.data.mediaId,
    attempt: job.attemptsMade,
    error: err.message,
  });
  if (job.attemptsMade >= attempts) {
    try {
      await rejectMedia(
        ctx.db,
        ctx.storage,
        job.data.mediaId,
        'We could not process this file. Please try uploading it again.',
      );
    } catch (e) {
      ctx.log.error('could not mark media rejected', { error: String(e) });
    }
  }
}
