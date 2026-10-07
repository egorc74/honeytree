import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { AppError } from './errors.ts';
import { loadUser } from './http/auth.ts';
import { getRedis } from './redis.ts';
import { mediaPlugin, type MediaPluginOptions } from './modules/media/index.ts';
import authRoutes from './modules/auth.ts';
import commentsRoutes from './modules/comments.ts';
import feedRoutes from './modules/feed.ts';
import gamesRoutes from './modules/games.ts';
import leaderboardRoutes from './modules/leaderboard.ts';
import likesRoutes from './modules/likes.ts';
import moderationRoutes from './modules/moderation.ts';
import reviewsRoutes from './modules/reviews.ts';
import searchRoutes from './modules/search.ts';
import systemRoutes from './modules/system.ts';
import usersRoutes from './modules/users.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

export type AppOptions = {
  /**
   * Media plugin (uploads, downloads; Agent 3). `false` turns it off. Without options it builds its own Postgres pool,
   * Redis connection and S3 client from the environment (`.env.example`); tests inject in-memory fakes.
   */
  media?: false | Partial<Omit<MediaPluginOptions, 'getUser'>>;
};

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isTest ? false : { level: config.isProd ? 'info' : 'debug' },
    trustProxy: config.isProd, // behind Caddy: use X-Forwarded-For for rate limiting
    bodyLimit: 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.webOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  if (config.rateLimitEnabled) {
    const redis = getRedis();
    await app.register(rateLimit, {
      global: true,
      max: 600,
      timeWindow: '1 minute',
      skipOnError: true,
      ...(redis ? { redis, nameSpace: 'ht:rl:' } : {}),
    });
  }

  // Browsers send `Content-Type: application/json` even on body-less PUT/DELETE: treat an empty body as "no body".
  const defaultJson = app.getDefaultJsonParser('error', 'ignore');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body) return done(null, undefined);
    defaultJson(req, body as string, (err, parsed) =>
      err ? done(new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON')) : done(null, parsed),
    );
  });

  // CSRF: cookies are SameSite=Lax; additionally refuse state-changing requests from foreign origins.
  const allowedOrigins = new Set(config.webOrigins);
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const origin = req.headers.origin;
    if (!SAFE_METHODS.has(req.method) && origin && !allowedOrigins.has(origin)) {
      throw new AppError(403, 'FORBIDDEN_ORIGIN', 'Requests from this origin are not allowed');
    }
    await loadUser(req);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof ZodError) {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.issues } });
    }
    if (err.code === 'P2002') {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: 'This already exists' } });
    }
    const status = err.statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.status(status).send({ error: { code: CODE_BY_STATUS[status] ?? 'BAD_REQUEST', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
  );

  await app.register(systemRoutes); // /healthz, /placeholders/*

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(usersRoutes);
      await api.register(gamesRoutes);
      await api.register(likesRoutes);
      await api.register(reviewsRoutes);
      await api.register(commentsRoutes);
      await api.register(feedRoutes);
      await api.register(leaderboardRoutes);
      await api.register(searchRoutes);
      await api.register(moderationRoutes);

      if (opts.media !== false && (opts.media || config.mediaEnabled)) {
        await api.register(mediaPlugin, {
          // The plugin never reads cookies itself: hand it our session lookup (filled by the global onRequest hook).
          getUser: (req) => (req.user ? { id: req.user.id, role: req.user.role } : null),
          ...opts.media,
        });
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}
