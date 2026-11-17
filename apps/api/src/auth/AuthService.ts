import type { Mailer } from '../mail/Mailer.js';
import type { Clock } from '../shared/Clock.js';
import type { User, UserRepository } from '../users/UserRepository.js';
import type { LoginCodeRepository } from './LoginCodeRepository.js';
import { SessionToken, type CodeHasher } from './secrets.js';
import type { SessionRepository } from './SessionRepository.js';

/** The numbers behind the sign-in rules, in one place. */
export const AUTH_POLICY = {
  codeTtlMs: 10 * 60_000,
  /** wrong guesses before a code is dead */
  maxAttempts: 5,
  /** minimum gap between codes for one email */
  resendWaitMs: 60_000,
  maxCodesPerHour: 5,
  sessionTtlMs: 30 * 24 * 60 * 60_000,
} as const;

/**
 * The rules of signing in, with no knowledge of HTTP or SQL.
 *
 * Sign-in has no passwords: we email a 6-digit code, the person types it in,
 * and their browser gets a session token. A new email address simply becomes a
 * new account the first time its code is verified.
 */
export class AuthService {
  constructor(
    private readonly codes: LoginCodeRepository,
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly mailer: Mailer,
    private readonly hasher: CodeHasher,
    private readonly clock: Clock,
  ) {}

  static normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async requestCode(rawEmail: string): Promise<'sent' | 'too_many'> {
    const email = AuthService.normalizeEmail(rawEmail);
    const now = this.clock.now();

    const issued = await this.codes.issuedSince(email, new Date(now.getTime() - 60 * 60_000));
    const newest = issued[0];
    if (issued.length >= AUTH_POLICY.maxCodesPerHour) return 'too_many';
    if (newest && now.getTime() - newest.getTime() < AUTH_POLICY.resendWaitMs) return 'too_many';

    const code = this.hasher.newCode();
    await this.codes.create({
      email,
      codeHash: this.hasher.hash(email, code),
      expiresAt: new Date(now.getTime() + AUTH_POLICY.codeTtlMs),
      createdAt: now,
    });
    await this.mailer.sendSignInCode(email, code);
    return 'sent';
  }

  /** A new session token and the user, or null if the code is wrong, expired, used or burnt. */
  async verifyCode(rawEmail: string, code: string): Promise<{ token: string; user: User } | null> {
    const email = AuthService.normalizeEmail(rawEmail);
    const now = this.clock.now();

    // Only the newest code for an email counts; asking for a new one retires the old.
    const issued = await this.codes.newestFor(email);
    if (!issued || issued.usedAt || issued.expiresAt <= now || issued.attempts >= AUTH_POLICY.maxAttempts) {
      return null;
    }
    if (!this.hasher.matches(issued.codeHash, email, code)) {
      await this.codes.recordWrongGuess(issued.id);
      return null;
    }
    if (!(await this.codes.claim(issued.id, now))) return null;

    const user = await this.users.findOrCreateByEmail(email, now);
    const token = SessionToken.issue();
    await this.sessions.create({
      userId: user.id,
      tokenHash: SessionToken.hash(token),
      expiresAt: new Date(now.getTime() + AUTH_POLICY.sessionTtlMs),
      createdAt: now,
    });
    return { token, user };
  }

  userForToken(token: string): Promise<User | null> {
    return this.sessions.findUser(SessionToken.hash(token), this.clock.now());
  }

  async signOut(token: string) {
    await this.sessions.deleteByTokenHash(SessionToken.hash(token));
  }
}
