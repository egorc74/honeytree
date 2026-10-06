import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';

export { prisma };

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Empties every table (all of them cascade from users). */
export async function resetDb() {
  await prisma.$executeRawUnsafe('TRUNCATE users CASCADE');
}

type Res = { status: number; body: any; headers: Record<string, any> };

/** A tiny cookie-keeping HTTP client on top of `app.inject`. */
export class Client {
  cookie = '';
  user: any = null;
  constructor(public app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    const res = await this.app.inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = ([] as string[]).concat((res.headers['set-cookie'] as string | string[] | undefined) ?? []);
    for (const c of set) {
      const [pair] = c.split(';');
      if (pair?.startsWith('ht_session=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let json: any = null;
    try {
      json = res.body ? res.json() : null;
    } catch {
      /* non-JSON body (e.g. svg) */
    }
    return { status: res.statusCode, body: json, headers: res.headers };
  }
  get = (url: string, headers?: Record<string, string>) => this.req('GET', url, undefined, headers);
  post = (url: string, body?: unknown, headers?: Record<string, string>) => this.req('POST', url, body, headers);
  put = (url: string, body?: unknown) => this.req('PUT', url, body);
  patch = (url: string, body?: unknown) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

export async function signup(app: FastifyInstance, username: string, extra: Record<string, unknown> = {}) {
  const c = new Client(app);
  const res = await c.post('/auth/register', { username, email: `${username}@test.io`, password: 'password123', ...extra });
  if (res.status !== 201) throw new Error(`signup(${username}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  c.user = res.body.user;
  return c;
}

export async function makeAdmin(c: Client) {
  await prisma.user.update({ where: { id: c.user.id }, data: { role: 'admin' } });
}

/** What Agent 3's upload pipeline will do: insert a media row. */
export function addMedia(gameId: string | null, ownerId: string, kind: 'cover' | 'screenshot' | 'build' | 'video' | 'avatar', status: 'ready' | 'scanning' | 'rejected' = 'ready') {
  return prisma.media.create({
    data: {
      gameId,
      ownerId,
      kind,
      status,
      storageKey: kind === 'build' ? `builds/${gameId}.zip` : `placeholder:${kind}-${Math.random().toString(36).slice(2, 8)}`,
      originalName: kind === 'build' ? 'game.zip' : `${kind}.png`,
      mime: kind === 'build' ? 'application/zip' : 'image/png',
      sizeBytes: 1234n,
    },
  });
}

/** Creates a draft with everything the publish rule needs, optionally publishing it. */
export async function makeGame(owner: Client, opts: { title?: string; publish?: boolean; extra?: Record<string, unknown> } = {}) {
  const res = await owner.post('/games', { title: opts.title ?? 'Test Game', ...opts.extra });
  if (res.status !== 201) throw new Error(`createGame failed: ${res.status} ${JSON.stringify(res.body)}`);
  const id: string = res.body.game.id;
  const cover = await addMedia(id, owner.user.id, 'cover');
  await addMedia(id, owner.user.id, 'screenshot');
  await addMedia(id, owner.user.id, 'build');
  const patched = await owner.patch(`/games/${id}`, { coverMediaId: cover.id });
  if (patched.status !== 200) throw new Error(`cover failed: ${JSON.stringify(patched.body)}`);
  if (opts.publish !== false) {
    const pub = await owner.post(`/games/${id}/publish`);
    if (pub.status !== 200) throw new Error(`publish failed: ${JSON.stringify(pub.body)}`);
  }
  return { id, slug: res.body.game.slug as string, coverId: cover.id };
}

export const karmaOf = async (username: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { username }, select: { karmaTotal: true } })).karmaTotal;
