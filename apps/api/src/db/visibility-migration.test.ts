import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';

it('upgrades populated private rooms without exposing or losing their contents, and can migrate twice', async () => {
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  const previous = mkdtempSync(join(tmpdir(), 'gossamer-old-schema-'));
  const journal = JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 2);
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) copyFileSync(join(folder, `${entry.tag}.sql`), join(previous, `${entry.tag}.sql`));
  const client = new PGlite();
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: previous });
    await db.execute(sql`insert into users (id, email) values ('00000000-0000-4000-8000-000000000001', 'migration@example.com')`);
    await db.execute(sql`insert into rooms (id, owner_id, title, invite_hash, closed, next_position)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Private memories', 'keep-this-hash', true, 2)`);
    await db.execute(sql`insert into room_members (room_id, user_id)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001')`);
    await db.execute(sql`insert into messages (room_id, sender_id, body, position, request_id)
      values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'A private note', 1, '00000000-0000-4000-8000-000000000003')`);
    await migrate(db, { migrationsFolder: folder });
    await migrate(db, { migrationsFolder: folder });
    const result = await db.execute(sql`select r.visibility, r.closed, r.invite_hash, r.next_position, m.body
      from rooms r join messages m on m.room_id = r.id join room_members rm on rm.room_id = r.id`);
    expect(result.rows).toEqual([{ visibility: 'private', closed: true, invite_hash: 'keep-this-hash', next_position: 2, body: 'A private note' }]);
    await expect(db.execute(sql`update rooms set visibility = 'invalid'`)).rejects.toThrow();
  } finally {
    await client.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
