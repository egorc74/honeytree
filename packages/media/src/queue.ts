import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import type { MediaKind } from './limits';

export const QUEUES = {
  scan: 'media-scan',
  image: 'media-image',
  video: 'media-video',
  maintenance: 'maintenance',
} as const;
export type MediaQueueName = typeof QUEUES.scan | typeof QUEUES.image | typeof QUEUES.video;

export interface MediaJobData {
  mediaId: string;
}

/** Which pipeline step handles a freshly completed upload of this kind. */
export function queueForKind(kind: MediaKind): MediaQueueName {
  if (kind === 'build') return QUEUES.scan;
  if (kind === 'video') return QUEUES.video;
  return QUEUES.image;
}

export interface JobQueue {
  /** Idempotent: enqueueing the same media twice while a job exists is a no-op. */
  enqueueMedia(queue: MediaQueueName, mediaId: string): Promise<void>;
  close(): Promise<void>;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: true,
  removeOnFail: { age: 60 * 60 },
};

export function createRedisConnection(url: string) {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export class BullJobQueue implements JobQueue {
  private readonly queues = new Map<string, Queue>();

  constructor(
    private readonly connection: Redis,
    private readonly jobOptions: JobsOptions = DEFAULT_JOB_OPTIONS,
  ) {}

  private queue(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: this.jobOptions });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueueMedia(queue: MediaQueueName, mediaId: string) {
    await this.queue(queue).add('process', { mediaId } satisfies MediaJobData, { jobId: mediaId });
  }

  async close() {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
