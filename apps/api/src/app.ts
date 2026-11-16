import { Hono } from 'hono';

// The app is built separately from the server that listens (index.ts) so tests
// can call `app.request('/api/health')` without opening a port.
export const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));
