import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';

export type User = { id: string; email: string };

/** Reads and writes the `users` table. The only place that knows its SQL. */
export class UserRepository {
  constructor(private readonly db: Db) {}

  /** The account for this email, created now if it doesn't exist yet. */
  async findOrCreateByEmail(email: string, at: Date): Promise<User> {
    await this.db.insert(users).values({ email, createdAt: at }).onConflictDoNothing({ target: users.email });
    const [user] = await this.db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email));
    if (!user) throw new Error(`user row missing right after insert for ${email}`);
    return user;
  }
}
