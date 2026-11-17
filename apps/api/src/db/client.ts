import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type LocalDb = Awaited<ReturnType<typeof openDb>>;

// PGlite is real Postgres running inside this process. Give it a folder and the
// data survives restarts; give it nothing and it lives in memory (used by tests).
// Every open applies any migrations that haven't run yet.
export async function openDb(dataDir?: string) {
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  return db;
}
