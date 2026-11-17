import { RoomController } from './rooms/RoomController.js';
import { RoomService } from './rooms/RoomService.js';
import { RoomRepository } from './rooms/RoomRepository.js';
import { sql } from 'drizzle-orm';
import { MailDeliveryError } from './mail/ResendMailer.js';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { csrf } from 'hono/csrf';
import { AuthController } from './auth/AuthController.js';
import { AuthService } from './auth/AuthService.js';
import { LoginCodeRepository } from './auth/LoginCodeRepository.js';
import { CodeHasher } from './auth/secrets.js';
import { SessionRepository } from './auth/SessionRepository.js';
import type { Db } from './db/client.js';
import type { Mailer } from './mail/Mailer.js';
import type { Clock } from './shared/Clock.js';
import { UserRepository } from './users/UserRepository.js';

export type AppDeps = {
  db: Db;
  mailer: Mailer;
  clock: Clock;
  authSecret: string;
  secureCookies: boolean;
  publicOrigin?: string;
  signInAllowlist?: string[];
};

// The one place where the pieces are wired together. Layers, outermost first:
//
//   controller  HTTP in and out (AuthController)
//   service     the rules (AuthService)
//   repository  SQL (…Repository)
//
// Each layer only knows the one below it, and everything it needs is handed in
// through its constructor. That is what lets tests swap in an in-memory
// database, a recording mailer and a clock they control.
export function createApp(deps: AppDeps) {
  const authService = new AuthService(
    new LoginCodeRepository(deps.db),
    new SessionRepository(deps.db),
    new UserRepository(deps.db),
    deps.mailer,
    new CodeHasher(deps.authSecret),
    deps.clock,
  );
  const authController = new AuthController(authService, deps.secureCookies, deps.signInAllowlist);

  const app = new Hono().basePath('/api');

  // Refuses form posts from other sites, on top of the SameSite cookie.
  app.use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (deps.publicOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      if (c.req.header('Origin') !== deps.publicOrigin) return c.json({ error: 'forbidden' }, 403);
    }
    await next();
  });
  app.use(csrf(deps.publicOrigin ? { origin: deps.publicOrigin } : undefined));

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/ready', async (c) => {
    try { await deps.db.execute(sql`select id from rooms limit 0`); return c.json({ ok: true }); }
    catch { return c.json({ ok: false }, 503); }
  });
  app.route('/auth', authController.routes());
  app.route('/rooms', new RoomController(new RoomService(new RoomRepository(deps.db), deps.clock), authController).routes());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof MailDeliveryError) return c.json({ error: 'email_unavailable' }, 503);
    console.error('API request failed');
    return c.json({ error: 'server_error' }, 500);
  });

  return app;
}
