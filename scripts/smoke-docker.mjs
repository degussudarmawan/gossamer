import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const compose = (...args) => execFileSync('docker', ['compose', ...args], { encoding: 'utf8', timeout: 90_000 });
const config = JSON.parse(compose('config', '--format', 'json'));
const settings = config.services.app.environment;
assert.equal(settings.NODE_ENV, 'development', 'Only run this check against local Compose');
assert.equal(settings.MAIL_MODE, 'console', 'Smoke tests require console email; no real email will be sent');
assert.equal(settings.SIGN_IN_ALLOWLIST, '', 'Smoke tests create synthetic accounts and require an empty local allowlist');
assert.equal(new URL(settings.DATABASE_URL).hostname, 'db', 'Refusing to test an external database');
const port = config.services.app.ports[0].published;
const base = `http://127.0.0.1:${port}`;
const request = (path, method = 'GET', body, cookie) => fetch(`${base}/api${path}`, {
  // The stack is recreated below; never reuse a socket connected to the old container.
  method, headers: { 'Content-Type': 'application/json', Connection: 'close', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
});
const expectStatus = (response, status) => assert.equal(response.status, status, `Unexpected status at ${response.url}`);
const login = async (name) => {
  const email = `docker-${name}-${randomUUID()}@example.com`;
  expectStatus(await request('/auth/request-code', 'POST', { email }), 200);
  // Read only this synthetic account's code; do not print codes or session cookies.
  const logs = compose('logs', '--no-color', '--tail', '200', 'app');
  const line = logs.split('\n').findLast((line) => line.includes(`sign-in code for ${email}: `));
  const code = line?.match(/: (\d{6})\s*$/)?.[1];
  assert.ok(code, 'Expected a console sign-in code for the synthetic account');
  const response = await request('/auth/verify-code', 'POST', { email, code });
  expectStatus(response, 200);
  return response.headers.get('set-cookie').split(';')[0];
};

expectStatus(await request('/ready'), 200);
const page = await fetch(`${base}/sign-in`, { headers: { Accept: 'text/html', Connection: 'close' }, signal: AbortSignal.timeout(10_000) });
expectStatus(page, 200);
assert.ok((await page.text()).includes('id="root"'), 'Built frontend did not load');
expectStatus(await request('/not-an-api-route'), 404);
const owner = await login('owner');
const friend = await login('friend');
const created = await request('/rooms', 'POST', { title: 'Docker smoke test' }, owner);
expectStatus(created, 201);
const { room, inviteCode } = await created.json();
expectStatus(await request(`/rooms/${room.id}`, 'GET', undefined, friend), 404);
expectStatus(await request('/rooms/join', 'POST', { code: inviteCode }, friend), 200);
const message = { body: 'Congratulations!', requestId: randomUUID() };
const sent = await request(`/rooms/${room.id}/messages`, 'POST', message, friend);
expectStatus(sent, 201);
const receipt = await sent.json();
const retry = await request(`/rooms/${room.id}/messages`, 'POST', message, friend);
expectStatus(retry, 201); assert.deepEqual(await retry.json(), receipt);

// Recreate the stack with the same named volume; committed data and sessions must survive.
compose('down', '--timeout', '10');
compose('up', '-d', '--wait', '--wait-timeout', '60');
const restored = await request(`/rooms/${room.id}/messages`, 'GET', undefined, owner);
expectStatus(restored, 200);
const messages = (await restored.json()).messages;
assert.equal(messages.length, 1); assert.equal(messages[0].body, message.body);
console.log('PASS: built frontend, readiness, sign-in, private rooms, message retries and data persistence after recreation');
