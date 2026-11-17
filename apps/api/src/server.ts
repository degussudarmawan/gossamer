import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { createApp } from './app.js';

/** One browser origin: /api belongs to Hono; frontend routes use the built SPA. */
export function createServer(api: ReturnType<typeof createApp>, webDist?: string) {
  const server = new Hono();
  server.route('/', api);
  server.all('/api', (c) => c.json({ error: 'not_found' }, 404));
  server.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
  if (webDist) {
    const root = resolve(webDist);
    // Fail startup if deployment forgot to build/package the frontend.
    const index = readFileSync(resolve(root, 'index.html'), 'utf8');
    server.use('*', serveStatic({ root }));
    server.get('*', (c) => {
      if (!c.req.header('Accept')?.includes('text/html') || c.req.path.startsWith('/assets/')) {
        return c.notFound();
      }
      c.header('Cache-Control', 'no-cache');
      return c.html(index);
    });
  }
  return server;
}
