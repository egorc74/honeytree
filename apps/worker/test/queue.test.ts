import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BullJobQueue,
  DEFAULT_JOB_OPTIONS,
  QUEUES,
  createRedisConnection,
} from '@honeytree/media/core';
import {
  MAINTENANCE_JOBS,
  scheduleMaintenance,
  startWorkers,
  type StartedWorkers,
} from '../src/jobs';
import { createWorkerEnv, type WorkerEnv } from './helpers';

// Needs a real Redis. CI provides one; locally run `redis-server` and set REDIS_URL.
const REDIS_URL = process.env.REDIS_URL;
const maybe = REDIS_URL ? describe : describe.skip;

async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 100));
  }
}

maybe('BullMQ wiring', () => {
  let env: WorkerEnv;
  let connection: Redis;
  let workers: StartedWorkers | undefined;

  beforeEach(async () => {
    env = await createWorkerEnv();
    connection = createRedisConnection(REDIS_URL!);
    await connection.flushdb();
  });
  afterEach(async () => {
    await workers?.close();
    workers = undefined;
    await connection.quit();
    await env.cleanup();
  });

  it('processes an enqueued image job end to end', async () => {
    const queue = new BullJobQueue(connection);
    const img = await sharp({
      create: { width: 800, height: 450, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const id = await env.addMedia('screenshot', 's.png', img);
    workers = startWorkers(env.ctx, connection);
    await queue.enqueueMedia(QUEUES.image, id);
    await queue.enqueueMedia(QUEUES.image, id); // same job id: ignored while it exists
    const row = await waitFor(async () => {
      const r = await env.row(id);
      return r.status === 'ready' ? r : false;
    });
    expect(row.variants.thumb.key).toBe(`media/${id}/thumb.webp`);
    await queue.close();
  });

  it('retries a failing scan and finally tells the uploader', async () => {
    const attempts: number[] = [];
    env.ctx.scanner = {
      scan: async () => {
        attempts.push(Date.now());
        throw new Error('clamd unavailable');
      },
    };
    const queue = new BullJobQueue(connection, {
      ...DEFAULT_JOB_OPTIONS,
      backoff: { type: 'fixed', delay: 50 },
    });
    const id = await env.addMedia('build', 'g.zip', Buffer.from('PK'));
    workers = startWorkers(env.ctx, connection);
    await queue.enqueueMedia(QUEUES.scan, id);
    const row = await waitFor(async () => {
      const r = await env.row(id);
      return r.status === 'rejected' ? r : false;
    });
    expect(attempts).toHaveLength(3);
    expect(row.variants.rejectReason).toMatch(/could not process/);
    await queue.close();
  });

  it('registers the maintenance schedule once, however often it starts', async () => {
    const q = new Queue(QUEUES.maintenance, { connection });
    await scheduleMaintenance(q);
    await scheduleMaintenance(q);
    const schedulers = await q.getJobSchedulers();
    expect(schedulers.map((s) => s.name)).toEqual(Object.values(MAINTENANCE_JOBS).sort());
    await q.close();
  });
});
