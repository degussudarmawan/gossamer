import { expect, it } from 'vitest';
import { loadConfig } from './config.js';

const live = { NODE_ENV: 'production', AUTH_SECRET: 'a'.repeat(32), DATABASE_URL: 'postgresql://user:pass@host/db',
  PUBLIC_ORIGIN: 'https://gossamer.example', MAIL_MODE: 'resend', RESEND_API_KEY: 'fake-test-key',
  MAIL_FROM: 'Gossamer <login@example.com>', SIGN_IN_ALLOWLIST: 'Owner@Example.com, friend@example.com' };

it('keeps local defaults without any production credentials', () => {
  const c = loadConfig({ SIGN_IN_ALLOWLIST: '' });
  expect(c.signInAllowlist).toBeUndefined();
  expect(c.mail.mode).toBe('console'); expect(c.databaseUrl).toBeUndefined(); expect(c.production).toBe(false);
});
it('supports real email locally without sharing a production database', () => {
  const c = loadConfig({ MAIL_MODE: 'resend', RESEND_API_KEY: 'test', MAIL_FROM: 'login@example.com' });
  expect(c.mail.mode).toBe('resend'); expect(c.databaseUrl).toBeUndefined();
});
it('requires hosted database, real email, HTTPS origin, strong secret and invited pilot users', () => {
  expect(loadConfig(live).signInAllowlist).toEqual(['owner@example.com', 'friend@example.com']);
  for (const key of ['AUTH_SECRET', 'DATABASE_URL', 'RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_ORIGIN', 'SIGN_IN_ALLOWLIST']) {
    expect(() => loadConfig({ ...live, [key]: '' })).toThrow();
  }
  expect(() => loadConfig({ ...live, MAIL_MODE: 'console' })).toThrow();
  expect(() => loadConfig({ ...live, PUBLIC_ORIGIN: 'http://example.com' })).toThrow();
  expect(() => loadConfig({ ...live, AUTH_SECRET: 'dev-only-secret' })).toThrow();
});
it('rejects invalid ports/URLs without echoing secrets', () => {
  for (const port of ['0', '-1', '65536', 'NaN', '1.5']) expect(() => loadConfig({ PORT: port })).toThrow();
  expect(() => loadConfig({ DATABASE_URL: 'password-secret' })).toThrow('DATABASE_URL must be a PostgreSQL connection URL');
  for (const origin of ['https://example.com/', 'https://example.com/path', 'https://name:secret@example.com']) {
    expect(() => loadConfig({ PUBLIC_ORIGIN: origin })).toThrow();
  }
});
