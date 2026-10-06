import type { Db, JobQueue, ObjectStorage } from '@honeytree/media/core';
import type { Scanner } from './clamav';
import type { Logger } from './log';

export interface WorkerContext {
  db: Db;
  storage: ObjectStorage;
  queue: JobQueue;
  scanner: Scanner;
  log: Logger;
  /** Directory for temporary files. */
  tmpDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  now: () => Date;
}
