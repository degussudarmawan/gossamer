import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Exercise the packaged Render entry point, not a shell-parsed approximation of it.
const command = readFileSync('render.yaml', 'utf8').match(/^\s+dockerCommand: (.+)$/m)?.[1];
assert.match(command ?? '', /^node dist\/[a-z-]+\.js$/, 'Hosted startup must be a plain Node command without shell quoting');
const project = `gossamer-hosted-${randomUUID().slice(0, 8)}`;
const dir = mkdtempSync(join(tmpdir(), 'gossamer-hosted-'));
const file = join(dir, 'compose.json');
const image = `gossamer:${process.env.IMAGE_TAG || 'local'}`;
const health = "fetch('http://127.0.0.1:8787/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))";
writeFileSync(file, JSON.stringify({
  services: {
    db: {
      image: 'postgres:17-bookworm',
      environment: { POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'local-test-only', POSTGRES_DB: 'hosted_test' },
      volumes: ['data:/var/lib/postgresql/data'],
      healthcheck: { test: ['CMD-SHELL', 'pg_isready -U test -d hosted_test'], interval: '2s', timeout: '5s', retries: 20 },
    },
    app: {
      image, command: command.split(' '),
      environment: {
        NODE_ENV: 'production', PORT: '8787',
        DATABASE_URL: 'postgresql://test:local-test-only@db:5432/hosted_test',
        AUTH_SECRET: 'hosted-smoke-test-secret-at-least-32-characters',
        RENDER_EXTERNAL_URL: 'https://hosted-test.onrender.com',
        MAIL_MODE: 'resend', RESEND_API_KEY: 'fake-never-send',
        MAIL_FROM: 'Test <login@example.com>', SIGN_IN_ALLOWLIST: 'test@example.com',
      },
      depends_on: { db: { condition: 'service_healthy' } },
      healthcheck: { test: ['CMD', 'node', '-e', health], interval: '2s', timeout: '5s', retries: 20 },
    },
  },
  volumes: { data: {} },
}));
const args = ['compose', '-p', project, '-f', file];
const compose = (...more) => execFileSync('docker', [...args, ...more], { encoding: 'utf8', timeout: 90_000, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  // No separate migration service: this database is empty until the hosted entry point runs.
  compose('up', '-d', '--wait', '--wait-timeout', '60');
  compose('exec', '-T', 'app', 'node', '-e', health);
  compose('restart', 'app');
  compose('up', '-d', '--wait', '--wait-timeout', '60');
  compose('exec', '-T', 'app', 'node', '-e', health);

  const failed = spawnSync('docker', [...args, 'run', '--rm', '--no-deps', '-e',
    'DATABASE_URL=postgresql://fake:fake@127.0.0.1:5432/unavailable', 'app'], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(failed.error);
  assert.equal(failed.status, 1);
  const output = failed.stdout + failed.stderr;
  assert.match(output, /database migration failed/);
  assert.doesNotMatch(output, /api listening/);
  console.log('PASS: exact hosted Node command, fresh migrations, repeated startup, and no server after migration failure');
} finally {
  try { compose('down', '--volumes', '--timeout', '10'); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
