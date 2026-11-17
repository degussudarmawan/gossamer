import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { openPostgres } from './postgres.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for hosted migrations');
const connection = openPostgres(url);
try {
  await migrate(connection.db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  console.log('database migrations applied');
} catch {
  // A database error can include SQL parameters or connection details.
  console.error('database migration failed; check database access and migration history');
  process.exitCode = 1;
} finally {
  await connection.close();
}
