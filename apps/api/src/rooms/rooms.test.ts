import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb, type LocalDb } from '../db/client.js';
import { messages, rooms } from '../db/schema.js';
import type { Ink } from './Ink.js';

type MessagePage = { messages: { id: string; body: string; ink: Ink | null; position: number }[]; nextAfter: number };
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
type RoomView = { id: string; visibility: 'private' | 'public'; isMember: boolean; isOwner: boolean; closed: boolean; title: string };
const createPublic = async () => {
  const res = await request('', owner, 'POST', { title: 'A little encouragement', visibility: 'public' });
  expect(res.status).toBe(201);
  const data = await res.json() as { room: RoomView; inviteCode: null };
  expect(data.inviteCode).toBeNull();
  expect(data.room).toMatchObject({ visibility: 'public', isMember: true, isOwner: true });
  return data.room;
};
const publicList = async (cookie = stranger) => {
  const res = await request('/public', cookie);
  expect(res.status).toBe(200);
  return (await res.json() as { rooms: RoomView[] }).rooms;
};

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

it('discovers public rooms and allows authenticated reading, but requires membership to write', async () => {
  await create();
  const room = await createPublic();
  expect((await request('/public')).status).toBe(401);
  expect((await request(`/${room.id}`)).status).toBe(401);
  expect((await request(`/${room.id}/messages`)).status).toBe(401);
  expect((await request(`/${room.id}/join`, undefined, 'POST')).status).toBe(401);
  expect(await publicList()).toEqual([expect.objectContaining({ id: room.id, isMember: false, isOwner: false })]);
  expect((await publicList(owner))[0]).toMatchObject({ isOwner: true, isMember: true });
  expect(await (await request('', stranger)).json()).toEqual({ rooms: [] });
  expect((await send(room.id, owner)).status).toBe(201);
  const read = await request(`/${room.id}`, stranger);
  expect(read.headers.get('cache-control')).toBe('no-store');
  expect(await read.json()).toMatchObject({ room: { isMember: false, visibility: 'public' } });
  const notes = await (await request(`/${room.id}/messages`, stranger)).json() as MessagePage;
  expect(notes.messages).toHaveLength(1);
  expect(JSON.stringify(notes)).not.toMatch(/senderId|email|inviteHash/);
  expect((await send(room.id, stranger)).status).toBe(404);
  for (let i = 0; i < 2; i++) {
    const joined = await request(`/${room.id}/join`, friend, 'POST');
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ room: { isMember: true, isOwner: false } });
  }
  expect((await publicList(friend))[0]!.isMember).toBe(true);
  expect((await send(room.id)).status).toBe(201);
  const listing = await (await request('', friend)).text();
  expect(listing).toContain(room.id);
  expect(listing).not.toMatch(/ownerId|inviteHash|nextPosition|example.com/);
  expect((await request(`/${room.id}/invite`, owner, 'POST')).status).toBe(409);
});

it('keeps closed public rooms readable by link, hides discovery, and blocks new joins and writes', async () => {
  const room = await createPublic();
  await request(`/${room.id}/join`, friend, 'POST');
  const receipt = await (await send(room.id)).json() as Receipt;
  expect((await request(`/${room.id}`, friend, 'PATCH', { closed: true })).status).toBe(403);
  expect((await request(`/${room.id}`, owner, 'PATCH', { closed: true })).status).toBe(200);
  expect(await publicList()).toEqual([]);
  expect((await request(`/${room.id}`, stranger)).status).toBe(200);
  expect((await request(`/${room.id}/messages`, stranger)).status).toBe(200);
  expect((await request(`/${room.id}/join`, friend, 'POST')).status).toBe(200);
  const blocked = await request(`/${room.id}/join`, stranger, 'POST');
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toEqual({ error: 'room_closed' });
  expect((await send(room.id)).status).toBe(409);
  expect((await request(`/${room.id}/messages/${receipt.message.id}`, friend, 'DELETE')).status).toBe(403);
  expect((await request(`/${room.id}/messages/${receipt.message.id}`, owner, 'DELETE')).status).toBe(200);
  expect((await request(`/${room.id}`, owner, 'PATCH', { closed: false })).status).toBe(200);
  expect(await publicList()).toHaveLength(1);
  expect((await request(`/${room.id}/join`, stranger, 'POST')).status).toBe(200);
});

it('lets only the owner change visibility and preserves members, notes, and private invite credentials', async () => {
  const { room, inviteCode } = await create();
  await join(inviteCode);
  await send(room.id);
  const [before] = await db.select().from(rooms).where(eq(rooms.id, room.id));
  expect(before!.visibility).toBe('private');
  expect((await request(`/${room.id}/join`, stranger, 'POST')).status).toBe(404);
  expect((await request(`/${randomUUID()}/join`, stranger, 'POST')).status).toBe(404);
  expect((await request(`/${room.id}`, friend, 'PATCH', { visibility: 'public' })).status).toBe(403);
  expect((await request(`/${room.id}`, stranger, 'PATCH', { visibility: 'public' })).status).toBe(404);
  expect((await request(`/${room.id}`, owner, 'PATCH', { visibility: 'public' })).status).toBe(200);
  expect((await publicList())[0]!.id).toBe(room.id);
  expect((await (await request(`/${room.id}/messages`, stranger)).json() as MessagePage).messages).toHaveLength(1);
  expect((await request(`/${room.id}`, owner, 'PATCH', { visibility: 'private' })).status).toBe(200);
  expect(await publicList()).toEqual([]);
  expect((await request(`/${room.id}`, stranger)).status).toBe(404);
  expect((await request(`/${room.id}/messages`, stranger)).status).toBe(404);
  expect((await request(`/${room.id}`, friend)).status).toBe(200);
  const [after] = await db.select().from(rooms).where(eq(rooms.id, room.id));
  expect(after!.inviteHash).toBe(before!.inviteHash);
  expect((await join(inviteCode, stranger)).status).toBe(200);
});

it('preserves public members when made private and can issue a private invitation afterward', async () => {
  const room = await createPublic();
  await request(`/${room.id}/join`, friend, 'POST');
  const response = await request(`/${room.id}`, owner, 'PATCH', { visibility: 'private', closed: true });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ room: { visibility: 'private', closed: true, isMember: true } });
  expect((await request(`/${room.id}`, friend)).status).toBe(200);
  expect((await request(`/${room.id}/join`, friend, 'POST')).status).toBe(404);
  const rotated = await request(`/${room.id}/invite`, owner, 'POST');
  expect(rotated.status).toBe(200);
  const { inviteCode } = await rotated.json() as { inviteCode: string };
  await request(`/${room.id}`, owner, 'PATCH', { closed: false });
  expect((await join(inviteCode, stranger)).status).toBe(200);
});

it('bounds discovery to the newest 100 open public rooms with stable ordering and no membership duplicates', async () => {
  const room = await createPublic();
  await request(`/${room.id}/join`, friend, 'POST');
  const [stored] = await db.select().from(rooms).where(eq(rooms.id, room.id));
  // Direct fixture insertion avoids hiding a slow unbounded discovery behind HTTP setup time.
  const fixtures = Array.from({ length: 105 }, (_, i) => ({ id: randomUUID(), ownerId: stored!.ownerId,
    title: `Room ${i}`, inviteHash: randomUUID(), visibility: 'public' as const,
    createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, Math.floor(i / 2))) }));
  await db.insert(rooms).values(fixtures);
  await db.insert(rooms).values([
    { ownerId: stored!.ownerId, title: 'Private', inviteHash: randomUUID(), createdAt: new Date('2031-01-01') },
    { ownerId: stored!.ownerId, title: 'Closed', inviteHash: randomUUID(), visibility: 'public', closed: true, createdAt: new Date('2031-01-01') },
  ]);
  const listed = await publicList();
  const expected = fixtures.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(0, 100);
  expect(listed.map((r) => r.id)).toEqual(expected.map((r) => r.id));
  expect(listed.every((r) => r.isMember === false && r.isOwner === false)).toBe(true);
  expect(JSON.stringify(listed)).not.toMatch(/ownerId|inviteHash|nextPosition|example.com/);
});

it('rejects invalid visibility changes and reserved names used as room IDs', async () => {
  const { room } = await create();
  for (const visibility of ['PUBLIC', 'unlisted', null, true]) {
    expect((await request('', owner, 'POST', { title: 'Bad', visibility })).status).toBe(400);
    expect((await request(`/${room.id}`, owner, 'PATCH', { visibility })).status).toBe(400);
  }
  for (const body of [{}, { visibility: 'public', ownerId: randomUUID() }, { closed: 'false' }]) {
    expect((await request(`/${room.id}`, owner, 'PATCH', body)).status).toBe(400);
  }
  for (const id of ['public', 'join', 'not-a-uuid']) {
    expect((await request(`/${id}/join`, owner, 'POST')).status).toBe(400);
    expect((await request(`/${id}/messages`, owner)).status).toBe(400);
  }
});

const drawing: Ink = { v: 1, lines: 3, width: 864, strokes: [[112, 40, 115, 52, 119, 71, 121, 80], [140, 61]] };
const note = (id: string, data: Record<string, unknown>, cookie = owner) =>
  request(`/${id}/messages`, cookie, 'POST', { requestId: randomUUID(), ...data });

it('round-trips handwriting with and without captions, alongside typed messages', async () => {
  const { room } = await create();
  expect((await note(room.id, { ink: drawing, body: '  Hello  ', signature: '  Friend  ' })).status).toBe(201);
  expect((await note(room.id, { ink: drawing })).status).toBe(201);
  expect((await note(room.id, { body: 'Typed' })).status).toBe(201);
  const page = await (await request(`/${room.id}/messages`, owner)).json() as MessagePage;
  expect(page.messages).toMatchObject([
    { body: 'Hello', ink: drawing, signature: 'Friend', position: 1 },
    { body: '', ink: drawing, signature: null, position: 2 },
    { body: 'Typed', ink: null, position: 3 },
  ]);
  const secondPage = await (await request(`/${room.id}/messages?after=1`, owner)).json() as MessagePage;
  expect(secondPage.messages.map((m) => m.position)).toEqual([2, 3]);
  expect(secondPage.nextAfter).toBe(3);
});

it('rejects empty notes, explicit empty captions, invalid ink and unexpected fields without storing anything', async () => {
  const { room } = await create();
  const invalidInk: unknown[] = [null, {}, [], 'svg', { ...drawing, v: 2 }, { ...drawing, extra: true },
    { ...drawing, lines: 0 }, { ...drawing, lines: 4 }, { ...drawing, width: 99 }, { ...drawing, width: 2001 },
    { ...drawing, lines: 1.5 }, { ...drawing, width: 200.5 }, { ...drawing, strokes: [] },
    { ...drawing, strokes: [[]] }, { ...drawing, strokes: [[0]] }, { ...drawing, strokes: [[0, 0, 1]] },
    { ...drawing, strokes: [[-1, 0]] }, { ...drawing, strokes: [[865, 0]] }, { ...drawing, strokes: [[0, 301]] },
    { ...drawing, strokes: [[0, 0.1]] }, { ...drawing, strokes: [['1', 0]] }, { ...drawing, strokes: [[0, null]] },
    { ...drawing, strokes: [Array(2002).fill(0)] }, { ...drawing, strokes: Array.from({ length: 401 }, () => [0, 0]) },
    { ...drawing, strokes: [...Array.from({ length: 4 }, () => Array(2000).fill(0)), [0, 0]] },
  ];
  const badNotes = [{}, { body: '' }, { body: '  ' }, { body: null }, { ink: drawing, body: '' },
    { ink: drawing, body: '  ' }, { ink: drawing, body: 'a'.repeat(2001) }, { ink: drawing, signature: '' },
    { ink: drawing, html: '<script/>' }, ...invalidInk.map((ink) => ({ ink }))];
  for (const data of badNotes) {
    const result = await note(room.id, data);
    expect(result.status, JSON.stringify(data).slice(0, 150)).toBe(400);
    expect(await result.json()).toEqual({ error: 'invalid_input' });
  }
  expect(await (await request(`/${room.id}/messages`, owner)).json()).toEqual({ messages: [], nextAfter: 0 });
});

it('accepts maximum legal ink above 16 KiB but caps note requests at 64 KiB and other routes at 16 KiB', async () => {
  const { room } = await create();
  const largest: Ink = { v: 1, lines: 3, width: 2000,
    strokes: Array.from({ length: 4 }, () => Array.from({ length: 2000 }, (_, i) => i % 2 ? 300 : 2000)) };
  expect(Buffer.byteLength(JSON.stringify(largest))).toBeGreaterThan(16 * 1024);
  const sent = await note(room.id, { ink: largest, body: '界'.repeat(2000), signature: '界'.repeat(80) });
  expect(sent.status).toBe(201);
  const page = await (await request(`/${room.id}/messages`, owner)).json() as MessagePage;
  expect(page.messages[0]!.ink).toEqual(largest);
  const paths = [
    ['', 'POST'], [`/${room.id}`, 'PATCH'], ['/join', 'POST'], [`/${room.id}/invite`, 'POST'],
    [`/${room.id}/join`, 'POST'], [`/${room.id}/messages`, 'PATCH'],
  ];
  for (const [path, method] of paths) {
    expect((await request(path!, owner, method!, { pad: 'a'.repeat(17 * 1024) })).status).toBe(413);
  }
  // Raw whitespace counts too; even a small logical JSON object cannot bypass the byte cap.
  const over = await app.request(`/api/rooms/${room.id}/messages`, { method: 'POST',
    headers: { cookie: owner, 'content-type': 'application/json' },
    body: ' '.repeat(64 * 1024) + JSON.stringify({ ink: drawing, requestId: randomUUID() }) });
  expect(over.status).toBe(413);
  expect((await db.select().from(messages)).length).toBe(1);
});

it('compares ink structurally for retries, including omitted captions and JSONB key order', async () => {
  const { room } = await create();
  const requestId = randomUUID();
  const original = await note(room.id, { ink: drawing, requestId });
  expect(original.status).toBe(201);
  const receipt = await original.json();
  const reordered = { strokes: drawing.strokes, width: drawing.width, lines: drawing.lines, v: 1 };
  const retry = await note(room.id, { ink: reordered, requestId });
  expect(retry.status).toBe(201);
  expect(await retry.json()).toEqual(receipt);
  for (const data of [{ ink: { ...drawing, width: 900 } }, { ink: { ...drawing, lines: 2 } },
    { ink: { ...drawing, strokes: [[0, 0]] } }, { ink: drawing, body: 'New caption' },
    { ink: drawing, signature: 'New signature' }, { body: 'Typed instead' }]) {
    const conflict = await note(room.id, { ...data, requestId });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: 'retry_conflict' });
  }
  const typedId = randomUUID();
  expect((await note(room.id, { body: 'Same caption', requestId: typedId })).status).toBe(201);
  expect((await note(room.id, { body: 'Same caption', ink: drawing, requestId: typedId })).status).toBe(409);
  const concurrentId = randomUUID();
  const concurrent = await Promise.all([note(room.id, { ink: drawing, requestId: concurrentId }),
    note(room.id, { ink: reordered, requestId: concurrentId })]);
  expect(concurrent.map((r) => r.status)).toEqual([201, 201]);
  const [a, b] = await Promise.all(concurrent.map((r) => r.json()));
  expect(a).toEqual(b);
});

it('erases removed handwriting and retains member, owner and closed-room permissions', async () => {
  const { room, inviteCode } = await create();
  expect((await note(room.id, { ink: drawing }, stranger)).status).toBe(404);
  expect((await request(`/${room.id}/messages`, stranger)).status).toBe(404);
  await join(inviteCode);
  const requestId = randomUUID();
  const receipt = await (await note(room.id, { ink: drawing, requestId }, friend)).json() as Receipt;
  const removePath = `/${room.id}/messages/${receipt.message.id}`;
  expect((await request(removePath, friend, 'DELETE')).status).toBe(403);
  await request(`/${room.id}`, owner, 'PATCH', { closed: true });
  expect((await note(room.id, { ink: drawing }, friend)).status).toBe(409);
  expect((await note(room.id, { ink: drawing, requestId }, friend)).status).toBe(201);
  expect((await request(removePath, owner, 'DELETE')).status).toBe(200);
  const [stored] = await db.select().from(messages).where(eq(messages.id, receipt.message.id));
  expect(stored).toMatchObject({ ink: null, body: '', signature: null });
  expect(stored!.removedAt).not.toBeNull();
  expect((await note(room.id, { ink: drawing, requestId }, friend)).status).toBe(409);
  expect(await (await request(`/${room.id}/messages`, friend)).json()).toEqual({ messages: [], nextAfter: 0 });
  const publicRoom = await createPublic();
  expect((await note(publicRoom.id, { ink: drawing }, stranger)).status).toBe(404);
  expect((await note(publicRoom.id, { ink: drawing })).status).toBe(201);
  const page = await (await request(`/${publicRoom.id}/messages`, stranger)).json() as MessagePage;
  expect(page.messages[0]!.ink).toEqual(drawing);
});
