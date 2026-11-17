import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { AuthController } from '../auth/AuthController.js';
import type { User } from '../users/UserRepository.js';
import { RoomError, type RoomService } from './RoomService.js';

const body = <T extends z.ZodType>(schema: T) => zValidator('json', schema, (result, c) => {
  if (!result.success) return c.json({ error: 'invalid_input' }, 400);
});

export class RoomController {
  constructor(private readonly service: RoomService, private readonly auth: AuthController) {}
  routes() {
    const app = new Hono<{ Variables: { user: User } }>();
    app.use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store');
      const user = await this.auth.currentUser(c);
      if (!user) return c.json({ error: 'unauthorized' }, 401);
      c.set('user', user);
      await next();
    });
    app.use('*', bodyLimit({ maxSize: 16 * 1024 }));
    app.use('/:id/*', async (c, next) => {
      const id = c.req.param('id');
      if (id !== 'join' && !z.uuid().safeParse(id).success) return c.json({ error: 'invalid_input' }, 400);
      await next();
    });
    app.onError((error, c) => {
      if (!(error instanceof RoomError)) throw error;
      const status = error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 409;
      return c.json({ error: error.code }, status);
    });
    app.get('/', async (c) => c.json({ rooms: await this.service.list(c.get('user').id) }));
    app.post('/', body(z.object({ title: z.string().trim().min(1).max(120), prompt: z.string().trim().max(1000).default('') }).strict()),
      async (c) => { const b = c.req.valid('json'); return c.json(await this.service.create(c.get('user').id, b.title, b.prompt), 201); });
    app.post('/join', body(z.object({ code: z.string().trim().regex(/^[a-fA-F0-9]{24}$/) }).strict()),
      async (c) => c.json({ room: await this.service.join(c.get('user').id, c.req.valid('json').code) }));
    app.get('/:id', async (c) => {
      if (!z.uuid().safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_input' }, 400);
      return c.json({ room: await this.service.read(c.req.param('id'), c.get('user').id) });
    });
    app.patch('/:id', body(z.object({ closed: z.boolean() }).strict()), async (c) => {
      if (!z.uuid().safeParse(c.req.param('id')).success) return c.json({ error: 'invalid_input' }, 400);
      return c.json({ room: await this.service.manage(c.req.param('id'), c.get('user').id, c.req.valid('json').closed) });
    });
    app.post('/:id/invite', async (c) => c.json(await this.service.rotate(c.req.param('id'), c.get('user').id)));
    app.get('/:id/messages', async (c) => {
      const after = z.coerce.number().int().min(0).max(2147483647).safeParse(c.req.query('after') ?? 0);
      if (!after.success) return c.json({ error: 'invalid_input' }, 400);
      const messages = await this.service.messages(c.req.param('id'), c.get('user').id, after.data);
      return c.json({ messages, nextAfter: messages.at(-1)?.position ?? after.data });
    });
    app.post('/:id/messages', body(z.object({ body: z.string().trim().min(1).max(2000),
      signature: z.string().trim().min(1).max(80).optional(), requestId: z.uuid() }).strict()),
      async (c) => c.json({ message: await this.service.send(c.req.param('id'), c.get('user').id, c.req.valid('json')) }, 201));
    app.delete('/:id/messages/:messageId', async (c) => {
      const messageId = c.req.param('messageId');
      if (!z.uuid().safeParse(messageId).success) return c.json({ error: 'invalid_input' }, 400);
      return c.json(await this.service.remove(c.req.param('id'), c.get('user').id, messageId));
    });
    return app;
  }
}
