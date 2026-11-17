import { zValidator } from '@hono/zod-validator';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AUTH_POLICY, type AuthService } from './AuthService.js';

const emailBody = z.object({ email: z.email().max(254) });
const verifyBody = emailBody.extend({ code: z.string().regex(/^\d{6}$/) });

// Any body that doesn't match gets the same short answer, with no detail about why.
const body = <T extends z.ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) return c.json({ error: 'invalid_input' }, 400);
  });

/**
 * The HTTP face of sign-in: reads requests, calls AuthService, writes responses
 * and the session cookie. It decides nothing about who may sign in.
 */
export class AuthController {
  private static readonly COOKIE = 'session';

  constructor(
    private readonly auth: AuthService,
    /** Send the cookie over HTTPS only. On in production, off for local http. */
    private readonly secureCookies: boolean,
    private readonly signInAllowlist?: string[],
  ) {}

  /** The signed-in user for this request, or null. Other controllers will use this too. */
  async currentUser(c: Context) {
    const token = getCookie(c, AuthController.COOKIE);
    return token ? this.auth.userForToken(token) : null;
  }

  routes() {
    return new Hono()
      .post('/request-code', body(emailBody), async (c) => {
        const email = c.req.valid('json').email;
        if (this.signInAllowlist && !this.signInAllowlist.includes(email.trim().toLowerCase())) return c.json({ ok: true });
        const outcome = await this.auth.requestCode(email);
        if (outcome === 'too_many') return c.json({ error: 'too_many_requests' }, 429);
        // Same answer whether or not this email has an account: there is nothing to probe.
        return c.json({ ok: true });
      })

      .post('/verify-code', body(verifyBody), async (c) => {
        const { email, code } = c.req.valid('json');
        if (this.signInAllowlist && !this.signInAllowlist.includes(email.trim().toLowerCase())) return c.json({ error: 'invalid_code' }, 401);
        const result = await this.auth.verifyCode(email, code);
        if (!result) return c.json({ error: 'invalid_code' }, 401);
        setCookie(c, AuthController.COOKIE, result.token, {
          httpOnly: true, // page scripts can't read it
          secure: this.secureCookies,
          sameSite: 'Lax',
          path: '/',
          maxAge: AUTH_POLICY.sessionTtlMs / 1000,
        });
        return c.json({ user: { email: result.user.email } });
      })

      .get('/me', async (c) => {
        const user = await this.currentUser(c);
        return c.json({ user: user ? { email: user.email } : null });
      })

      .post('/sign-out', async (c) => {
        const token = getCookie(c, AuthController.COOKIE);
        if (token) await this.auth.signOut(token);
        deleteCookie(c, AuthController.COOKIE, { path: '/' });
        return c.json({ ok: true });
      });
  }
}
