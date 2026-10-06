import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import type { JobQueue, MediaQueueName } from '../queue';
import type { BucketName, ObjectStorage, PresignedPut } from '../storage';

/** In-memory ObjectStorage for tests. A "presigned" PUT is simulated by calling `upload`. */
export class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Buffer>();
  private k = (bucket: BucketName, key: string) => `${bucket}/${key}`;

  /** Simulates the browser PUT-ing a file to a presigned URL. */
  upload(bucket: BucketName, key: string, body: Uint8Array) {
    this.objects.set(this.k(bucket, key), Buffer.from(body));
  }
  has(bucket: BucketName, key: string) {
    return this.objects.has(this.k(bucket, key));
  }
  keys(bucket: BucketName, prefix = '') {
    return [...this.objects.keys()]
      .filter((k) => k.startsWith(`${bucket}/${prefix}`))
      .map((k) => k.slice(bucket.length + 1));
  }

  async head(bucket: BucketName, key: string) {
    const o = this.objects.get(this.k(bucket, key));
    return o ? { size: o.length } : null;
  }
  async getRange(bucket: BucketName, key: string, start: number, end: number) {
    const o = this.objects.get(this.k(bucket, key));
    if (!o) throw new Error(`NoSuchKey ${bucket}/${key}`);
    return new Uint8Array(o.subarray(start, end + 1));
  }
  async downloadToFile(bucket: BucketName, key: string, path: string) {
    const o = this.objects.get(this.k(bucket, key));
    if (!o) throw new Error(`NoSuchKey ${bucket}/${key}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, o);
  }
  async openReadStream(bucket: BucketName, key: string) {
    const o = this.objects.get(this.k(bucket, key));
    if (!o) throw new Error(`NoSuchKey ${bucket}/${key}`);
    return Readable.from([o]);
  }
  async putFile(bucket: BucketName, key: string, path: string) {
    this.objects.set(this.k(bucket, key), await readFile(path));
  }
  async putBuffer(bucket: BucketName, key: string, body: Uint8Array) {
    this.objects.set(this.k(bucket, key), Buffer.from(body));
  }
  async delete(bucket: BucketName, key: string) {
    this.objects.delete(this.k(bucket, key));
  }
  async deletePrefix(bucket: BucketName, prefix: string) {
    for (const key of this.keys(bucket, prefix)) this.objects.delete(this.k(bucket, key));
  }
  async presignPut(
    bucket: BucketName,
    key: string,
    opts: { contentType: string },
  ): Promise<PresignedPut> {
    return {
      url: `http://storage.test/${bucket}/${key}?signature=put`,
      headers: { 'Content-Type': opts.contentType },
    };
  }
  async presignGet(bucket: BucketName, key: string, opts: { downloadName?: string }) {
    return `http://storage.test/${bucket}/${key}?signature=get&name=${encodeURIComponent(opts.downloadName ?? '')}`;
  }
  publicUrl(key: string) {
    return `http://media.test/${key}`;
  }
}

/** Records enqueued jobs instead of sending them to Redis. */
export class MemoryQueue implements JobQueue {
  readonly jobs: { queue: MediaQueueName; mediaId: string }[] = [];
  async enqueueMedia(queue: MediaQueueName, mediaId: string) {
    if (!this.jobs.some((j) => j.queue === queue && j.mediaId === mediaId)) {
      this.jobs.push({ queue, mediaId });
    }
  }
  async close() {}
}
