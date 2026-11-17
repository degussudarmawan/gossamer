import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// The cryptography of sign-in, kept apart from its rules. Neither codes nor
// session tokens are ever stored: only these one-way hashes of them.

/** Makes sign-in codes and the hashes we store for them. */
export class CodeHasher {
  /**
   * @param secret Server-only secret mixed into every hash. A code is only six
   * digits, so without it a leaked database could be searched for every code.
   */
  constructor(private readonly secret: string) {}

  newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  hash(email: string, code: string): string {
    return createHmac('sha256', this.secret).update(`${email}:${code}`).digest('hex');
  }

  /** Compared in constant time, so response timing reveals nothing about the code. */
  matches(storedHash: string, email: string, code: string): boolean {
    const stored = Buffer.from(storedHash, 'hex');
    const given = Buffer.from(this.hash(email, code), 'hex');
    return stored.length === given.length && timingSafeEqual(stored, given);
  }
}

/** The random value a signed-in browser holds in its cookie. */
export class SessionToken {
  static issue(): string {
    return randomBytes(32).toString('base64url');
  }

  /** 32 random bytes can't be guessed, so a plain hash is enough to store safely. */
  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
