import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { sql } from 'drizzle-orm';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { openPostgres } from './db/postgres.js';
import { ConsoleMailer } from './mail/Mailer.js';
import { ResendMailer } from './mail/ResendMailer.js';
import { createServer } from './server.js';
import { SystemClock } from './shared/Clock.js';

async function start() {
  const config = loadConfig();
  const connection = config.databaseUrl ? openPostgres(config.databaseUrl) : await (async () => {
    mkdirSync(config.dataDir, { recursive: true });
    const db = await openDb(config.dataDir);
    return { db, close: () => db.$client.close() };
  })();
  try {
    // Detect missing migrations before accepting requests.
    await connection.db.execute(sql`select id from rooms limit 0`);
    const app = createApp({ db: connection.db,
      mailer: config.mail.mode === 'resend' ? new ResendMailer(config.mail.apiKey, config.mail.from) : new ConsoleMailer(),
      clock: new SystemClock(), authSecret: config.authSecret, secureCookies: config.production,
      publicOrigin: config.publicOrigin, signInAllowlist: config.signInAllowlist });
    const webDist = config.webDist ?? (config.production ? fileURLToPath(new URL('../../web/dist', import.meta.url)) : undefined);
    const server = serve({ fetch: createServer(app, webDist).fetch, port: config.port, hostname: '0.0.0.0' }, () => {
      console.log(`api listening on port ${config.port}; database=${config.databaseUrl ? 'postgres' : 'pglite'}; mail=${config.mail.mode}`);
    });
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      server.close(() => {
        void connection.close().then(() => { clearTimeout(deadline); process.exitCode = 0; }, () => process.exit(1));
      });
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    await connection.close();
    throw error;
  }
}

start().catch((error: unknown) => {
  console.error(error instanceof ConfigError ? error.message : 'API startup failed. Check database migrations, connectivity, and frontend build.');
  process.exitCode = 1;
});
