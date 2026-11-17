import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

// Network PostgreSQL for staging/production. TLS is configured via the provider URL;
// do not disable certificate verification here. Migrations are a separate release step.
export function openPostgres(connectionString: string) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30_000 });
  pool.on('error', () => console.error('database pool connection failed'));
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
