import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import type { User } from '../users/UserRepository.js';

/** Reads and writes the `sessions` table. The only place that knows its SQL. */
export class SessionRepository {
  constructor(private readonly db: Db) {}

  async create(session: { userId: string; tokenHash: string; expiresAt: Date; createdAt: Date }) {
    await this.db.insert(sessions).values(session);
  }

  /** The user behind a session that hasn't expired, or null. */
  async findUser(tokenHash: string, at: Date): Promise<User | null> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, at)));
    return row ?? null;
  }

  async deleteByTokenHash(tokenHash: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }
}
