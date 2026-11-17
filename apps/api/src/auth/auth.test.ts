import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb, type Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { AUTH_POLICY } from './AuthService.js';

const { codeTtlMs: CODE_TTL_MS, maxAttempts: MAX_ATTEMPTS, resendWaitMs: RESEND_WAIT_MS } = AUTH_POLICY;

// Each test gets its own in-memory database, a mailer that records what it was
// asked to send, and a clock the test can move.
let db: Db;
let app: ReturnType<typeof createApp>;
let sent: { email: string; code: string }[];
let clock: Date;

beforeEach(async () => {
  db = await openDb();
  sent = [];
  clock = new Date('2026-11-17T10:00:00Z');
  app = createApp({
    db,
    mailer: { sendSignInCode: async (email, code) => void sent.push({ email, code }) },
    clock: { now: () => clock },
    authSecret: 'test-secret',
    secureCookies: false,
  });
});

const wait = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};

const post = (path: string, body: unknown, cookie?: string) =>
  app.request(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

const me = async (cookie?: string) => {
  const res = await app.request('/api/auth/me', { headers: cookie ? { cookie } : {} });
  return (await res.json()) as { user: { email: string } | null };
};

const lastCode = () => sent[sent.length - 1]!.code;
const wrong = (code: string) => (code === '000000' ? '000001' : '000000');
// "session=abc; Path=/; HttpOnly" -> "session=abc"
const cookieFrom = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]!;

describe('signing in with an email code', () => {
  it('signs in, stays signed in, and signs out', async () => {
    expect((await post('request-code', { email: 'ana@example.com' })).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(lastCode()).toMatch(/^\d{6}$/);

    const res = await post('verify-code', { email: 'ana@example.com', code: lastCode() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { email: 'ana@example.com' } });
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);

    const cookie = cookieFrom(res);
    expect(await me(cookie)).toEqual({ user: { email: 'ana@example.com' } });
    expect(await me()).toEqual({ user: null });

    expect((await post('sign-out', {}, cookie)).status).toBe(200);
    expect(await me(cookie)).toEqual({ user: null });
  });

  it('treats differently-typed versions of an email as one account', async () => {
    await post('request-code', { email: 'Ana@Example.com' });
    expect((await post('verify-code', { email: 'ana@example.com', code: lastCode() })).status).toBe(200);

    wait(RESEND_WAIT_MS);
    await post('request-code', { email: 'ANA@example.com' });
    expect((await post('verify-code', { email: 'Ana@example.com', code: lastCode() })).status).toBe(200);

    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('rejects a wrong code', async () => {
    await post('request-code', { email: 'ana@example.com' });
    const res = await post('verify-code', { email: 'ana@example.com', code: wrong(lastCode()) });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('kills a code after too many wrong guesses, even for the right one', async () => {
    await post('request-code', { email: 'ana@example.com' });
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await post('verify-code', { email: 'ana@example.com', code: wrong(lastCode()) });
    }
    expect((await post('verify-code', { email: 'ana@example.com', code: lastCode() })).status).toBe(401);
  });

  it('rejects an expired code', async () => {
    await post('request-code', { email: 'ana@example.com' });
    wait(CODE_TTL_MS + 1000);
    expect((await post('verify-code', { email: 'ana@example.com', code: lastCode() })).status).toBe(401);
  });

  it('lets a code be used only once', async () => {
    await post('request-code', { email: 'ana@example.com' });
    const code = lastCode();
    expect((await post('verify-code', { email: 'ana@example.com', code })).status).toBe(200);
    expect((await post('verify-code', { email: 'ana@example.com', code })).status).toBe(401);
  });

  it('accepts only the newest code', async () => {
    await post('request-code', { email: 'ana@example.com' });
    const old = lastCode();
    wait(RESEND_WAIT_MS);
    await post('request-code', { email: 'ana@example.com' });
    if (old !== lastCode()) {
      expect((await post('verify-code', { email: 'ana@example.com', code: old })).status).toBe(401);
    }
    expect((await post('verify-code', { email: 'ana@example.com', code: lastCode() })).status).toBe(200);
  });

  it("does not accept one person's code for another email", async () => {
    await post('request-code', { email: 'ana@example.com' });
    expect((await post('verify-code', { email: 'ben@example.com', code: lastCode() })).status).toBe(401);
  });

  it('refuses to send codes too quickly, and sends nothing', async () => {
    expect((await post('request-code', { email: 'ana@example.com' })).status).toBe(200);
    expect((await post('request-code', { email: 'ana@example.com' })).status).toBe(429);
    expect(sent).toHaveLength(1);

    wait(RESEND_WAIT_MS);
    expect((await post('request-code', { email: 'ana@example.com' })).status).toBe(200);
    expect(sent).toHaveLength(2);
  });

  it('rejects malformed input', async () => {
    expect((await post('request-code', { email: 'not-an-email' })).status).toBe(400);
    expect((await post('verify-code', { email: 'ana@example.com', code: '12ab56' })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('ignores a made-up session cookie', async () => {
    expect(await me('session=not-a-real-token')).toEqual({ user: null });
  });
});
