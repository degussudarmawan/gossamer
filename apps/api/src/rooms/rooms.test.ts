import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb, type LocalDb } from '../db/client.js';
import { rooms } from '../db/schema.js';

type MessagePage = { messages: { id: string; body: string; position: number }[]; nextAfter: number };
type Receipt = { message: { id: string; position: number } };
let db: LocalDb;
let app: ReturnType<typeof createApp>;
let owner: string;
let friend: string;
let stranger: string;
const request = (path: string, cookie?: string, method = 'GET', body?: unknown) => app.request(`/api/rooms${path}`, {
  method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const create = async () => {
  const res = await request('', owner, 'POST', { title: 'Graduation', prompt: 'A memory?' });
  expect(res.status).toBe(201);
  return await res.json() as { room: { id: string }; inviteCode: string };
};
const join = (code: string, cookie = friend) => request('/join', cookie, 'POST', { code });
const send = (id: string, cookie = friend, requestId = randomUUID(), body = 'Congratulations!') =>
  request(`/${id}/messages`, cookie, 'POST', { body, signature: 'A friend', requestId });

beforeEach(async () => {
  db = await openDb();
  const codes = new Map<string, string>();
  app = createApp({ db, mailer: { sendSignInCode: async (email, code) => { codes.set(email, code); } },
    clock: { now: () => new Date() }, authSecret: 'test-secret', secureCookies: false });
  const login = async (email: string) => {
    const post = (path: string, body: unknown) => app.request(`/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    await post('request-code', { email });
    const res = await post('verify-code', { email, code: codes.get(email) });
    return res.headers.get('set-cookie')!.split(';')[0]!;
  };
  owner = await login('owner@example.com'); friend = await login('friend@example.com'); stranger = await login('stranger@example.com');
});
afterEach(async () => { await db.$client.close(); });

it('keeps room content private, joins by code, and never returns account details or invite hashes', async () => {
  const { room, inviteCode } = await create();
  expect((await request(`/${room.id}`)).status).toBe(401);
  expect((await request(`/${room.id}`, stranger)).status).toBe(404);
  expect((await request(`/${room.id}/messages`, stranger)).status).toBe(404);
  expect((await send(room.id, stranger)).status).toBe(404);
  expect(await (await request('', stranger)).json()).toEqual({ rooms: [] });
  expect((await join(inviteCode.toLowerCase())).status).toBe(200);
  expect((await join(inviteCode)).status).toBe(200);
  expect((await send(room.id)).status).toBe(201);
  const read = await request(`/${room.id}/messages`, owner);
  expect(read.headers.get('cache-control')).toBe('no-store');
  const data = await read.json() as MessagePage;
  expect(data.messages[0]!.body).toBe('Congratulations!');
  expect(JSON.stringify(data)).not.toMatch(/senderId|email|inviteHash/);
  const details = await (await request(`/${room.id}`, friend)).text();
  expect(details).not.toMatch(/ownerId|inviteHash|nextPosition|example.com/);
  const stored = await db.select().from(rooms);
  expect(stored[0]!.inviteHash).not.toBe(inviteCode);
});

it('restricts owner controls and invalidates old invitations without evicting members', async () => {
  const { room, inviteCode } = await create(); await join(inviteCode);
  expect((await request(`/${room.id}/invite`, friend, 'POST')).status).toBe(403);
  expect((await request(`/${room.id}`, friend, 'PATCH', { closed: true })).status).toBe(403);
  const rotated = await (await request(`/${room.id}/invite`, owner, 'POST')).json() as { inviteCode: string };
  expect((await join(inviteCode, stranger)).status).toBe(404);
  expect((await request(`/${room.id}`, friend)).status).toBe(200);
  expect((await request(`/${room.id}`, owner, 'PATCH', { closed: true })).status).toBe(200);
  expect((await join(rotated.inviteCode, stranger)).status).toBe(409);
  expect((await send(room.id)).status).toBe(409);
  expect((await request(`/${room.id}/messages`, friend)).status).toBe(200);
  await request(`/${room.id}`, owner, 'PATCH', { closed: false });
  expect((await join(rotated.inviteCode, stranger)).status).toBe(200);
});

it('assigns unique positions for concurrent sends and makes retries idempotent', async () => {
  const { room, inviteCode } = await create(); await join(inviteCode);
  const key = randomUUID();
  const results = await Promise.all([send(room.id, friend, key), send(room.id, friend, key), send(room.id)]);
  expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
  const receipts = await Promise.all(results.map((r) => r.json()));
  expect(receipts[0]).toEqual(receipts[1]);
  expect((await send(room.id, friend, key, 'Changed content')).status).toBe(409);
  const data = await (await request(`/${room.id}/messages`, owner)).json() as MessagePage;
  expect(data.messages.map((m: { position: number }) => m.position)).toEqual([1, 2]);
  const page = await (await request(`/${room.id}/messages?after=1`, owner)).json() as MessagePage;
  expect(page.messages).toHaveLength(1); expect(page.nextAfter).toBe(2);
});

it('removes messages only within the owned room and never resurrects them on retries', async () => {
  const { room, inviteCode } = await create(); await join(inviteCode);
  const key = randomUUID();
  const receipt = await (await send(room.id, friend, key)).json() as Receipt;
  const second = await create();
  const path = `/${room.id}/messages/${receipt.message.id}`;
  expect((await request(path, friend, 'DELETE')).status).toBe(403);
  expect((await request(`/${second.room.id}/messages/${receipt.message.id}`, owner, 'DELETE')).status).toBe(404);
  expect((await request(path, owner, 'DELETE')).status).toBe(200);
  expect((await send(room.id, friend, key)).status).toBe(409);
  const next = await (await send(room.id)).json() as Receipt; expect(next.message.position).toBe(2);
  const data = await (await request(`/${room.id}/messages`, owner)).json() as MessagePage;
  expect(data.messages).toHaveLength(1); expect(data.messages[0]!.id).not.toBe(receipt.message.id);
});

it('rejects malformed identifiers, unbounded content, forged fields, and cross-site writes', async () => {
  const { room } = await create();
  expect((await request('/not-a-uuid', owner)).status).toBe(400);
  expect((await request('/not-a-uuid/messages', owner)).status).toBe(400);
  expect((await request(`/${room.id}/messages?after=oops`, owner)).status).toBe(400);
  expect((await request('', owner, 'POST', { title: ' ', ownerId: randomUUID() })).status).toBe(400);
  expect((await send(room.id, owner, randomUUID(), 'a'.repeat(2001))).status).toBe(400);
  expect((await app.request(`/api/rooms/${room.id}/invite`, { method: 'POST',
    headers: { cookie: owner, origin: 'https://evil.example', 'content-type': 'text/plain' } })).status).toBe(403);
});
