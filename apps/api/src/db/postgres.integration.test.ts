import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openPostgres } from './postgres.js';
import { loginCodes } from './schema.js';

// Never read DATABASE_URL here. This suite only accepts an explicitly named local test database.
const raw = process.env.POSTGRES_TEST_URL;
if (!raw) throw new Error('POSTGRES_TEST_URL is required; use a disposable local gossamer_test database');
const url = new URL(raw);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/gossamer_test') {
  throw new Error('PostgreSQL integration tests require a local database named gossamer_test');
}
const first = openPostgres(raw);
const second = openPostgres(raw);
const sent = new Map<string, string[]>();
const suffix = randomUUID();
const address = (name: string) => `${name}-${suffix}@example.com`;
const makeApp = (connection: typeof first) => createApp({ db: connection.db,
  mailer: { sendSignInCode: async (email, code) => { sent.set(email, [...(sent.get(email) ?? []), code]); } },
  clock: { now: () => new Date() }, authSecret: 'postgres-integration-test-only', secureCookies: false });
const app = makeApp(first);
const otherApp = makeApp(second);
const request = (target: typeof app, path: string, method = 'GET', body?: unknown, cookie?: string) => target.request(`/api${path}`, {
  method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const login = async (email: string) => {
  expect((await request(app, '/auth/request-code', 'POST', { email })).status).toBe(200);
  const response = await request(app, '/auth/verify-code', 'POST', { email, code: sent.get(email)!.at(-1) });
  expect(response.status).toBe(200);
  return response.headers.get('set-cookie')!.split(';')[0]!;
};
beforeAll(async () => {
  const settings = { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) };
  await migrate(first.db, settings);
  // A second release must not attempt to recreate existing tables.
  await migrate(first.db, settings);
}, 30_000);
afterAll(async () => { await Promise.all([first.close(), second.close()]); });

it('applies migrations and serves readiness through the network adapter', async () => {
  expect((await request(app, '/ready')).status).toBe(200);
});

it('limits concurrent email-code requests across independent connection pools', async () => {
  const email = address('concurrent-send');
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    request(i % 2 ? app : otherApp, '/auth/request-code', 'POST', { email })));
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 429)).toHaveLength(7);
  expect(sent.get(email)).toHaveLength(1);
});

it('accepts a code only once across simultaneous verification requests', async () => {
  const email = address('single-use');
  await request(app, '/auth/request-code', 'POST', { email });
  const code = sent.get(email)![0]!;
  const responses = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    request(i % 2 ? app : otherApp, '/auth/verify-code', 'POST', { email, code })));
  expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
  expect(responses.filter((r) => r.status === 401)).toHaveLength(5);
});

it('caps wrong guesses at five even when attempts arrive concurrently', async () => {
  const email = address('attempt-limit');
  await request(app, '/auth/request-code', 'POST', { email });
  const actual = sent.get(email)![0]!;
  const code = actual === '000000' ? '000001' : '000000';
  const responses = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    request(i % 2 ? app : otherApp, '/auth/verify-code', 'POST', { email, code })));
  expect(responses.every((r) => r.status === 401)).toBe(true);
  const [stored] = await first.db.select().from(loginCodes).where(eq(loginCodes.email, email));
  expect(stored!.attempts).toBe(5);
  expect((await request(app, '/auth/verify-code', 'POST', { email, code: actual })).status).toBe(401);
});

it('persists rooms, enforces membership and serializes retries across two API instances', async () => {
  const owner = await login(address('owner'));
  const member = await login(address('member'));
  const stranger = await login(address('stranger'));
  const created = await request(app, '/rooms', 'POST', { title: 'Graduation' }, owner);
  expect(created.status).toBe(201);
  const { room, inviteCode } = await created.json() as { room: { id: string }; inviteCode: string };
  expect((await request(otherApp, `/rooms/${room.id}`, 'GET', undefined, stranger)).status).toBe(404);
  expect((await request(otherApp, '/rooms/join', 'POST', { code: inviteCode }, member)).status).toBe(200);
  const requestId = randomUUID();
  const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => request(i % 2 ? app : otherApp,
    `/rooms/${room.id}/messages`, 'POST', { body: 'Congratulations', requestId: i < 4 ? requestId : randomUUID() }, member)));
  expect(responses.every((r) => r.status === 201)).toBe(true);
  const rows = await (await request(app, `/rooms/${room.id}/messages`, 'GET', undefined, owner)).json() as {
    messages: { id: string; position: number }[];
  };
  expect(rows.messages.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
  // A fresh network connection sees the same persisted data.
  const reopened = openPostgres(raw);
  try {
    const response = await request(makeApp(reopened), `/rooms/${room.id}/messages`, 'GET', undefined, owner);
    expect(await response.json()).toEqual({ ...rows, nextAfter: 5 });
  } finally { await reopened.close(); }
  expect((await request(otherApp, `/rooms/${room.id}`, 'PATCH', { closed: true }, owner)).status).toBe(200);
  expect((await request(app, `/rooms/${room.id}/messages`, 'POST', { body: 'Late', requestId: randomUUID() }, member)).status).toBe(409);
  const removed = rows.messages[0]!.id;
  expect((await request(otherApp, `/rooms/${room.id}/messages/${removed}`, 'DELETE', undefined, owner)).status).toBe(200);
  const remaining = await (await request(app, `/rooms/${room.id}/messages`, 'GET', undefined, owner)).json() as typeof rows;
  expect(remaining.messages).toHaveLength(4);
});
