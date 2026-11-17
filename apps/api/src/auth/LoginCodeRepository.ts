import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { loginCodes } from '../db/schema.js';

export type LoginCode = typeof loginCodes.$inferSelect;

/** Reads and writes the `login_codes` table. The only place that knows its SQL. */
export class LoginCodeRepository {
  constructor(private readonly db: Db) {}

  async create(code: { email: string; codeHash: string; expiresAt: Date; createdAt: Date }) {
    await this.db.insert(loginCodes).values(code);
  }

  /** When codes were issued for this email since the given time, newest first. */
  async issuedSince(email: string, since: Date): Promise<Date[]> {
    const rows = await this.db
      .select({ createdAt: loginCodes.createdAt })
      .from(loginCodes)
      .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, since)))
      .orderBy(desc(loginCodes.createdAt));
    return rows.map((row) => row.createdAt);
  }

  async newestFor(email: string): Promise<LoginCode | undefined> {
    const [row] = await this.db
      .select()
      .from(loginCodes)
      .where(eq(loginCodes.email, email))
      .orderBy(desc(loginCodes.createdAt))
      .limit(1);
    return row;
  }

  async recordWrongGuess(id: string) {
    await this.db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(eq(loginCodes.id, id));
  }

  /** Marks the code used. False if it was already used: of two racing requests, only one wins. */
  async claim(id: string, at: Date): Promise<boolean> {
    const claimed = await this.db
      .update(loginCodes)
      .set({ usedAt: at })
      .where(and(eq(loginCodes.id, id), isNull(loginCodes.usedAt)))
      .returning({ id: loginCodes.id });
    return claimed.length > 0;
  }
}
