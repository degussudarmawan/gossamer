import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb, type LocalDb } from './db/client.js';
import { createServer } from './server.js';
import { MailDeliveryError } from './mail/ResendMailer.js';
import { loadConfig } from './config.js';

let db: LocalDb;
let dir: string;
let server: ReturnType<typeof createServer>;
let sent: { email: string; code: string }[] = [];
let failMail = false;
beforeAll(async () => {
  db = await openDb();
  dir = mkdtempSync(join(tmpdir(), 'gossamer-static-test-'));
  mkdirSync(join(dir, 'assets')); writeFileSync(join(dir, 'index.html'), '<html>Gossamer test</html>');
  writeFileSync(join(dir, 'assets/app.js'), 'console.log("test")');
  server = createServer(createApp({ db, mailer: { sendSignInCode: async (email, code) => {
    if (failMail) throw new MailDeliveryError(); sent.push({ email, code });
  } }, clock: { now: () => new Date() }, authSecret: 'test-secret', secureCookies: true,
  publicOrigin: 'https://gossamer.example', signInAllowlist: ['owner@example.com', 'fail@example.com'] }), dir);
});
afterAll(async () => { await db.$client.close(); rmSync(dir, { recursive: true, force: true }); });
const post = (path: string, data: unknown, origin = 'https://gossamer.example') => server.request(`/api/auth/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', Origin: origin }, body: JSON.stringify(data),
});
it('serves the SPA and assets while preserving unknown API/missing asset 404s', async () => {
  expect(await (await server.request('/rooms/example', { headers: { Accept: 'text/html' } })).text()).toContain('Gossamer test');
  expect((await server.request('/assets/app.js')).status).toBe(200);
  expect((await server.request('/assets/missing.js', { headers: { Accept: 'text/html' } })).status).toBe(404);
  expect((await server.request('/api/missing', { headers: { Accept: 'text/html' } })).status).toBe(404);
  expect((await server.request('/api')).status).toBe(404);
  expect((await server.request('/rooms/example', { method: 'POST' })).status).toBe(404);
  expect((await server.request('/api/ready')).status).toBe(200);
});
it('rejects cross-origin and origin-less JSON writes in the hosted app', async () => {
  expect((await post('request-code', { email: 'owner@example.com' }, 'https://evil.example')).status).toBe(403);
  expect((await server.request('/api/auth/request-code', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com' }) })).status).toBe(403);
  expect(sent).toHaveLength(0);
});
it('signs in allowed pilot users with secure cookies, without revealing the allowlist', async () => {
  expect(await (await post('request-code', { email: 'stranger@example.com' })).json()).toEqual({ ok: true });
  expect(sent).toHaveLength(0);
  expect((await post('verify-code', { email: 'stranger@example.com', code: '123456' })).status).toBe(401);
  expect((await post('request-code', { email: 'owner@example.com' })).status).toBe(200);
  expect(sent).toHaveLength(1);
  const response = await post('verify-code', { email: 'owner@example.com', code: sent[0]!.code });
  expect(response.status).toBe(200);
  expect(response.headers.get('set-cookie')).toMatch(/Secure/);
  expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/);
  // Hosted HTTPS origin remains valid behind an internal HTTP proxy, including simple requests.
  const signOut = await server.request('/api/auth/sign-out', { method: 'POST', headers: {
    Origin: 'https://gossamer.example', 'content-type': 'text/plain', cookie: response.headers.get('set-cookie')!.split(';')[0]!,
  } });
  expect(signOut.status).toBe(200);
});
it('reports delivery failure instead of claiming that a code was sent', async () => {
  failMail = true;
  const response = await post('request-code', { email: 'fail@example.com' });
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'email_unavailable' });
});

it('lets an unlisted email verify in public production mode while keeping resend limits and secure sessions', async () => {
  const config = loadConfig({ NODE_ENV: 'production', AUTH_SECRET: 'p'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost/test', PUBLIC_ORIGIN: 'https://gossamer.example',
    MAIL_MODE: 'resend', RESEND_API_KEY: 'fake-test-key', MAIL_FROM: 'login@example.com',
    SIGN_IN_MODE: 'public', SIGN_IN_ALLOWLIST: 'owner@example.com' });
  const delivered: { email: string; code: string }[] = [];
  const publicServer = createServer(createApp({ db, authSecret: config.authSecret,
    publicOrigin: config.publicOrigin, signInAllowlist: config.signInAllowlist,
    secureCookies: config.production, clock: { now: () => new Date() },
    mailer: { sendSignInCode: async (email, code) => { delivered.push({ email, code }); } } }));
  const request = (path: string, data: unknown) => publicServer.request(`/api/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', Origin: config.publicOrigin! },
    body: JSON.stringify(data),
  });
  const email = 'new-public-user@example.com';
  expect((await request('request-code', { email })).status).toBe(200);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]!.email).toBe(email);
  expect((await request('request-code', { email })).status).toBe(429);
  expect(delivered).toHaveLength(1);
  const verified = await request('verify-code', { email, code: delivered[0]!.code });
  expect(verified.status).toBe(200);
  expect(await verified.json()).toEqual({ user: { email } });
  expect(verified.headers.get('set-cookie')).toMatch(/Secure/);
  expect(verified.headers.get('set-cookie')).toMatch(/HttpOnly/);
  const cookie = verified.headers.get('set-cookie')!.split(';')[0]!;
  const current = await publicServer.request('/api/auth/me', { headers: { cookie } });
  expect(current.status).toBe(200);
  expect(await current.json()).toEqual({ user: { email } });
  expect((await request('verify-code', { email, code: delivered[0]!.code })).status).toBe(401);
});
