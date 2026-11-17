import { RoomController } from './rooms/RoomController.js';
import { RoomService } from './rooms/RoomService.js';
import { RoomRepository } from './rooms/RoomRepository.js';
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
  const authController = new AuthController(authService, deps.secureCookies);

  const app = new Hono().basePath('/api');

  // Refuses form posts from other sites, on top of the SameSite cookie.
  app.use(csrf());

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authController.routes());
  app.route('/rooms', new RoomController(new RoomService(new RoomRepository(deps.db), deps.clock), authController).routes());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(`${c.req.method} ${c.req.path} failed:`, err);
    return c.json({ error: 'server_error' }, 500);
  });

  return app;
}
