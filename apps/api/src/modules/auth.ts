import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.ts';
import { AppError, conflict, unauthenticated } from '../errors.ts';
import { createSession, destroySession, requireUser } from '../http/auth.ts';
import { toMe } from '../http/serializers.ts';
import { parse, text } from '../http/validate.ts';

const RESERVED = new Set(['admin', 'root', 'honeytree', 'support', 'system', 'me', 'api', 'null', 'undefined', 'moderator']);

const registerBody = z.object({
  username: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().regex(/^[a-z0-9_]{3,24}$/, 'must be 3-24 characters: a-z, 0-9 and _'))
    .refine((u) => !RESERVED.has(u), 'this username is reserved'),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8).max(128),
  displayName: text(1, 40).optional(),
});

const loginBody = z.object({
  identifier: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(128),
});

// Verified against when the account does not exist, so response time does not reveal which accounts exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= argon2.hash('honeytree-dummy-password'));

const authLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: authLimit }, async (req, reply) => {
    const body = parse(registerBody, req.body);

    const existing = await prisma.user.findFirst({
      where: { OR: [{ username: body.username }, { email: body.email }] },
      select: { username: true },
    });
    if (existing) {
      throw existing.username === body.username
        ? conflict('USERNAME_TAKEN', 'This username is already taken')
        : conflict('EMAIL_TAKEN', 'An account with this email already exists');
    }

    const user = await prisma.user
      .create({
        data: {
          username: body.username,
          email: body.email,
          passwordHash: await argon2.hash(body.password),
          displayName: body.displayName || body.username,
        },
      })
      .catch((e: { code?: string }) => {
        if (e?.code === 'P2002') throw conflict('ALREADY_EXISTS', 'Username or email is already taken');
        throw e;
      });

    await createSession(reply, user.id);
    return reply.status(201).send({ user: await toMe(user) });
  });

  app.post('/auth/login', { config: authLimit }, async (req, reply) => {
    const body = parse(loginBody, req.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ email: body.identifier }, { username: body.identifier }] },
    });
    const ok = await argon2.verify(user?.passwordHash ?? (await getDummyHash()), body.password).catch(() => false);
    if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username/email or password');

    await createSession(reply, user.id);
    return { user: await toMe(user) };
  });

  app.post('/auth/logout', async (req, reply) => {
    await destroySession(req, reply);
    return reply.status(204).send();
  });

  app.get('/auth/me', async (req) => {
    const auth = requireUser(req);
    const user = await prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw unauthenticated();
    return { user: await toMe(user) };
  });
}
