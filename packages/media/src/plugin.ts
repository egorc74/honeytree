import { Pool } from 'pg';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { loadMediaConfig, type MediaConfig } from './config';
import type { Db } from './db';
import { MediaError, unauthenticated } from './errors';
import { MEDIA_KINDS } from './limits';
import { BullJobQueue, createRedisConnection, type JobQueue } from './queue';
import { serializeMedia } from './serialize';
import { MediaService, type AuthUser } from './service';
import { S3Storage, type ObjectStorage } from './storage';

export interface MediaPluginOptions {
  /**
   * Resolve the logged-in user for a request, or null for anonymous requests.
   * The plugin never reads cookies itself: plug in the API's session lookup.
   */
  getUser: (req: FastifyRequest) => Promise<AuthUser | null> | AuthUser | null;
  /** Everything below defaults to what the environment variables in `.env.example` describe. */
  config?: MediaConfig;
  db?: Db;
  storage?: ObjectStorage;
  queue?: JobQueue;
}

const uuid = z.string().uuid();
const idParams = z.object({ id: uuid });

const uploadBody = z.object({
  kind: z.enum(MEDIA_KINDS),
  filename: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mime: z.string().max(255),
});

const orderBody = z.object({ mediaIds: z.array(uuid).max(50) });
const downloadQuery = z.object({ mediaId: uuid.optional() });

const mediaPlugin: FastifyPluginAsync<MediaPluginOptions> = async (app, opts) => {
  const needsConfig = !opts.db || !opts.storage || !opts.queue;
  const config = opts.config ?? (needsConfig ? loadMediaConfig() : undefined);

  const owned: { close: () => Promise<unknown> }[] = [];
  let db = opts.db;
  if (!db) {
    const pool = new Pool({ connectionString: config!.databaseUrl, max: 5 });
    owned.push({ close: () => pool.end() });
    db = pool;
  }
  const storage = opts.storage ?? new S3Storage(config!.s3);
  let queue = opts.queue;
  if (!queue) {
    const connection = createRedisConnection(config!.redisUrl);
    const bull = new BullJobQueue(connection);
    owned.push({ close: () => bull.close() }, { close: () => connection.quit() });
    queue = bull;
  }
  app.addHook('onClose', async () => {
    for (const resource of owned) await resource.close();
  });

  const service = new MediaService({
    db,
    storage,
    queue,
    ipHashSalt: config?.ipHashSalt ?? 'dev-only-salt',
  });
  const toDto = (m: Parameters<typeof serializeMedia>[0]) =>
    serializeMedia(m, storage.publicUrl('').replace(/\/$/, ''));

  const requireUser = async (req: FastifyRequest) => {
    const user = await opts.getUser(req);
    if (!user) throw unauthenticated();
    return user;
  };

  // Errors from this plugin use the shared `{ error: { code, message } }` format.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof MediaError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof z.ZodError) {
      const message = err.issues
        .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message } });
    }
    req.log.error({ err }, 'media plugin error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });

  const ticketDto = (t: Awaited<ReturnType<MediaService['createUpload']>>) => ({
    uploadId: t.uploadId,
    url: t.url,
    method: t.method,
    headers: t.headers,
    fields: t.fields,
    expiresAt: t.expiresAt,
    media: toDto(t.media),
  });

  app.post('/games/:id/uploads', async (req, reply) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const ticket = await service.createUpload(user, { gameId: id }, uploadBody.parse(req.body));
    return reply.status(201).send(ticketDto(ticket));
  });

  app.post('/users/me/uploads', async (req, reply) => {
    const user = await requireUser(req);
    const ticket = await service.createUpload(user, { avatar: true }, uploadBody.parse(req.body));
    return reply.status(201).send(ticketDto(ticket));
  });

  app.post('/uploads/:id/complete', async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { media: toDto(await service.completeUpload(user, id)) };
  });

  app.get('/uploads/:id', async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    return { media: toDto(await service.getUpload(user, id)) };
  });

  app.delete('/media/:id', async (req, reply) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    await service.deleteMedia(user, id);
    return reply.status(204).send();
  });

  app.patch('/games/:id/media/order', async (req) => {
    const user = await requireUser(req);
    const { id } = idParams.parse(req.params);
    const { mediaIds } = orderBody.parse(req.body);
    return { items: (await service.reorderScreenshots(user, id, mediaIds)).map(toDto) };
  });

  app.get('/games/:id/download', async (req, reply) => {
    const user = await opts.getUser(req);
    const { id } = idParams.parse(req.params);
    const { mediaId } = downloadQuery.parse(req.query);
    const result = await service.resolveDownload(user, id, { mediaId, ip: req.ip });
    if ('error' in result) throw result.error;
    return reply
      .header('Cache-Control', 'no-store')
      .header('X-Download-Counted', String(result.counted))
      .redirect(result.redirectUrl, 302);
  });
};

export default mediaPlugin;
export { mediaPlugin };
export type { FastifyInstance };
