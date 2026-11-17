import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db/client.js';
import { ConsoleMailer } from './mail/Mailer.js';
import { SystemClock } from './shared/Clock.js';

const config = loadConfig();

mkdirSync(config.dataDir, { recursive: true });
const db = await openDb(config.dataDir);

const app = createApp({
  db,
  mailer: new ConsoleMailer(), // real email arrives with the deploy slice
  clock: new SystemClock(),
  authSecret: config.authSecret,
  secureCookies: config.production,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
