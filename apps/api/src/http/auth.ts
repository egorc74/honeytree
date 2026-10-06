import '@fastify/cookie'; // type augmentation: req.cookies / reply.setCookie
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { prisma } from '../db.ts';
import { forbidden, unauthenticated } from '../errors.ts';

export const SESSION_COOKIE = 'ht_session';

export type AuthUser = { id: string; username: string; role: 'user' | 'admin' };

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(reply: FastifyReply, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  // Only the hash is stored: a leaked sessions table cannot be replayed as cookies.
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** onRequest hook: resolves the session cookie into `req.user` (or null). */
export async function loadUser(req: FastifyRequest) {
  req.user = null;
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: { id: true, username: true, role: true } } },
  });
  if (!session) return;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return;
  }
  req.user = session.user;
}

export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden('Admins only');
  return user;
}
