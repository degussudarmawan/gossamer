import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

it('adds nullable ink to existing messages without changing their text, ordering or visibility', async () => {
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const previous = mkdtempSync(join(tmpdir(), 'gossamer-before-ink-'));
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 3);
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(folder, `${entry.tag}.sql`), join(previous, `${entry.tag}.sql`));
  const client = new PGlite();
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: previous });
    await db.execute(sql`insert into users (id, email) values ('00000000-0000-4000-8000-000000000001', 'migration@example.com')`);
    await db.execute(sql`insert into rooms (id, owner_id, title, invite_hash, next_position, visibility)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Memories', 'keep-hash', 2, 'public')`);
    await db.execute(sql`insert into messages (room_id, sender_id, body, signature, position, request_id)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'An existing note', 'Friend', 1, '00000000-0000-4000-8000-000000000003')`);
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    const result = await db.execute(sql`select m.body, m.signature, m.position, m.ink, r.visibility, r.next_position
      from messages m join rooms r on r.id = m.room_id`);
    expect(result.rows).toEqual([{ body: 'An existing note', signature: 'Friend', position: 1, ink: null, visibility: 'public', next_position: 2 }]);
  } finally {
    await client.close();
    rmSync(previous, { recursive: true, force: true });
  }
}, 30_000);
