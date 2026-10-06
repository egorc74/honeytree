import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, karmaOf, makeApp, makeAdmin, makeGame, prisma, resetDb, signup } from './helpers.ts';

let app: FastifyInstance;
let alice: Client; // creator
let bob: Client;
let cara: Client;
let game: { id: string; slug: string };
beforeAll(async () => (app = await makeApp()));
afterAll(async () => app.close());
beforeEach(async () => {
  await resetDb();
  alice = await signup(app, 'alice');
  bob = await signup(app, 'bob');
  cara = await signup(app, 'cara');
  game = await makeGame(alice, { title: 'Commented Game' });
});

const say = async (c: Client, body: string, extra: Record<string, unknown> = {}) => {
  const res = await c.post(`/games/${game.id}/comments`, { body, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.comment as any;
};
const list = async (c: Client, qs = '') => (await c.get(`/games/${game.id}/comments${qs}`)).body;

describe('writing comments', () => {
  it('creates comments and suggestions, and counts them on the game', async () => {
    const c = await say(bob, 'First!');
    expect(c).toMatchObject({ kind: 'comment', body: 'First!', parentId: null, likesCount: 0, likedByMe: false, deleted: false, acceptedAt: null, repliesCount: 0, replies: [], user: { username: 'bob' } });
    expect(await say(bob, 'Add dark mode', { kind: 'suggestion' })).toMatchObject({ kind: 'suggestion' });
    expect((await bob.get(`/games/${game.slug}`)).body.game.commentsCount).toBe(2);
  });

  it('validates input and requires login and a published game', async () => {
    expect((await bob.post(`/games/${game.id}/comments`, { body: '   ' })).status).toBe(422);
    expect((await bob.post(`/games/${game.id}/comments`, { body: 'x'.repeat(2001) })).status).toBe(422);
    expect((await bob.post(`/games/${game.id}/comments`, { body: 'hi', kind: 'rant' })).status).toBe(422);
    expect((await new Client(app).post(`/games/${game.id}/comments`, { body: 'hi' })).status).toBe(401);
    const draft = await makeGame(alice, { title: 'Hidden Draft', publish: false });
    expect((await bob.post(`/games/${draft.id}/comments`, { body: 'hi' })).status).toBe(404);
  });

  it('strips HTML from comment bodies', async () => {
    const c = await say(bob, 'hello <img src=x onerror=alert(1)><b>world</b>');
    expect(c.body).toBe('hello world');
  });
});

describe('threads', () => {
  it('nests replies one level deep, oldest first, with counts', async () => {
    const top = await say(bob, 'Top comment');
    const r1 = await say(alice, 'Reply 1', { parentId: top.id });
    const r2 = await say(cara, 'Reply 2', { parentId: top.id });
    expect(r1.parentId).toBe(top.id);
    expect(r1).not.toHaveProperty('replies'); // replies themselves have no replies array

    const items = (await list(bob)).items;
    expect(items).toHaveLength(1);
    expect(items[0].repliesCount).toBe(2);
    expect(items[0].replies.map((r: any) => r.id)).toEqual([r1.id, r2.id]);
    expect((await bob.get(`/games/${game.slug}`)).body.game.commentsCount).toBe(3);
  });

  it.each([
    ['replying to a reply', async (reply: any) => ({ parentId: reply.id })],
    ['a suggestion reply', async (_r: any, top: any) => ({ parentId: top.id, kind: 'suggestion' })],
    ['a missing parent', async () => ({ parentId: '00000000-0000-7000-8000-000000000000' })],
    ['a malformed parent', async () => ({ parentId: 'nope' })],
  ])('rejects %s', async (_name, build) => {
    const top = await say(bob, 'Top');
    const reply = await say(cara, 'Reply', { parentId: top.id });
    const res = await alice.post(`/games/${game.id}/comments`, { body: 'Nested', ...(await build(reply, top)) });
    expect(res.status).toBe(422);
  });

  it('rejects a parent from another game or a deleted parent', async () => {
    const other = await makeGame(alice, { title: 'Other Game' });
    const foreign = (await bob.post(`/games/${other.id}/comments`, { body: 'Elsewhere' })).body.comment;
    expect((await cara.post(`/games/${game.id}/comments`, { body: 'x', parentId: foreign.id })).status).toBe(422);

    const top = await say(bob, 'Soon gone');
    await bob.del(`/comments/${top.id}`);
    expect((await cara.post(`/games/${game.id}/comments`, { body: 'x', parentId: top.id })).status).toBe(422);
  });
});

describe('listing', () => {
  it('sorts by top (likes) or new, filters by kind, paginates with a stable cursor', async () => {
    const a = await say(bob, 'oldest, most liked');
    await new Promise((r) => setTimeout(r, 5));
    const b = await say(cara, 'middle suggestion', { kind: 'suggestion' });
    await new Promise((r) => setTimeout(r, 5));
    const c = await say(bob, 'newest');
    await cara.put(`/comments/${a.id}/like`);
    await alice.put(`/comments/${a.id}/like`);
    await alice.put(`/comments/${b.id}/like`);

    expect((await list(bob)).items.map((x: any) => x.id)).toEqual([a.id, b.id, c.id]); // 2 likes, 1 like, 0
    expect((await list(bob, '?sort=new')).items.map((x: any) => x.id)).toEqual([c.id, b.id, a.id]);
    expect((await list(bob, '?kind=suggestion')).items.map((x: any) => x.id)).toEqual([b.id]);

    for (const sort of ['top', 'new']) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: any = await list(bob, `?sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...page.items.map((x: any) => x.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(new Set(seen).size, sort).toBe(3);
      expect(seen, sort).toEqual((await list(bob, `?sort=${sort}`)).items.map((x: any) => x.id));
    }
  });

  it('sets likedByMe per viewer on comments and replies', async () => {
    const top = await say(bob, 'Top');
    const reply = await say(cara, 'Reply', { parentId: top.id });
    await alice.put(`/comments/${top.id}/like`);
    await alice.put(`/comments/${reply.id}/like`);
    const asAlice = (await list(alice)).items[0];
    expect([asAlice.likedByMe, asAlice.replies[0].likedByMe]).toEqual([true, true]);
    const asAnon = (await list(new Client(app))).items[0];
    expect([asAnon.likedByMe, asAnon.replies[0].likedByMe]).toEqual([false, false]);
  });
});

describe('deleting', () => {
  it('soft-deletes: the author, the game creator and admins may; others may not', async () => {
    const c = await say(bob, 'Delete me');
    expect((await cara.del(`/comments/${c.id}`)).status).toBe(403);
    expect((await new Client(app).del(`/comments/${c.id}`)).status).toBe(401);
    expect((await alice.del(`/comments/${c.id}`)).status).toBe(200); // game creator moderates their own page

    const row = await prisma.comment.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.deletedAt).toBeTruthy();
    expect(row.body).toBe(''); // the text is really gone
    expect((await list(bob)).items).toHaveLength(0); // no replies -> no tombstone
    expect((await alice.del(`/comments/${c.id}`)).body).toEqual({ karmaAwarded: 0 }); // idempotent

    await makeAdmin(cara);
    const c2 = await say(bob, 'Admin target');
    expect((await cara.del(`/comments/${c2.id}`)).status).toBe(200);
  });

  it('keeps a tombstone while replies exist, hiding body and author', async () => {
    const top = await say(bob, 'Controversial take');
    await say(cara, 'Disagree', { parentId: top.id });
    await bob.del(`/comments/${top.id}`);
    const items = (await list(cara)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: top.id, deleted: true, body: null, user: null, repliesCount: 1 });
    expect(items[0].replies[0].body).toBe('Disagree');
  });

  it("reverses the author's karma, likes received and the game's comment count", async () => {
    const c = await say(bob, 'Liked then deleted');
    await cara.put(`/comments/${c.id}/like`);
    expect(await karmaOf('bob')).toBe(2);
    expect((await bob.get('/users/bob')).body.user.stats.likesReceived).toBe(1);

    expect((await bob.del(`/comments/${c.id}`)).body).toEqual({ karmaAwarded: -2 });
    expect(await karmaOf('bob')).toBe(0);
    expect((await bob.get('/users/bob')).body.user.stats.likesReceived).toBe(0);
    expect((await bob.get(`/games/${game.slug}`)).body.game.commentsCount).toBe(0);
    expect(await karmaOf('cara')).toBe(1); // the liker keeps theirs
  });
});

describe('accepting suggestions', () => {
  it('lets only the game creator accept, awards +10 to the suggester, and is reversible', async () => {
    const s = await say(bob, 'Please add a dark mode', { kind: 'suggestion' });
    expect(await karmaOf('bob')).toBe(3);

    expect((await bob.post(`/comments/${s.id}/accept`)).status).toBe(403); // not even the author
    expect((await cara.post(`/comments/${s.id}/accept`)).status).toBe(403);
    const ok = await alice.post(`/comments/${s.id}/accept`);
    expect(ok.body.comment.acceptedAt).toBeTruthy();
    expect(await karmaOf('bob')).toBe(13);
    await alice.post(`/comments/${s.id}/accept`); // idempotent
    expect(await karmaOf('bob')).toBe(13);
    expect((await list(bob)).items[0].acceptedAt).toBeTruthy();

    await alice.del(`/comments/${s.id}/accept`);
    expect(await karmaOf('bob')).toBe(3);
    expect((await list(bob)).items[0].acceptedAt).toBeNull();
  });

  it('only top-level suggestions by others can be accepted', async () => {
    const plain = await say(bob, 'Just a comment');
    expect((await alice.post(`/comments/${plain.id}/accept`)).body.error.code).toBe('NOT_A_SUGGESTION');
    const own = (await alice.post(`/games/${game.id}/comments`, { body: 'My own idea', kind: 'suggestion' })).body.comment;
    expect((await alice.post(`/comments/${own.id}/accept`)).body.error.code).toBe('OWN_SUGGESTION');
    expect((await alice.post('/comments/not-a-uuid/accept')).status).toBe(404);
  });

  it('deleting an accepted suggestion revokes both the suggestion and the acceptance karma', async () => {
    const s = await say(bob, 'Great idea', { kind: 'suggestion' });
    await alice.post(`/comments/${s.id}/accept`);
    expect(await karmaOf('bob')).toBe(13);
    expect((await bob.del(`/comments/${s.id}`)).body).toEqual({ karmaAwarded: -13 });
    expect(await karmaOf('bob')).toBe(0);
  });
});
