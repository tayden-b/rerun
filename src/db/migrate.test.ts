import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, openDb } from './index';
import * as schema from './schema';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('0001_incidents_run_id_unique', () => {
  it('upgrades a database that already holds two incidents for one run', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rerun-migrate-'));
    const url = `file:${path.join(dir, 'rerun.db')}`;
    // The schema as of 0000 only: copy the migrations and drop the later journal entries.
    const before = path.join(dir, 'drizzle');
    cpSync(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = path.join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag.startsWith('0000_'));
    writeFileSync(journalPath, JSON.stringify(journal));
    const client = createClient({ url });
    const old = drizzle(client, { schema });
    await migrate(old, { migrationsFolder: before });
    await old.insert(schema.incidents).values([
      {
        id: 'first',
        runId: 'run-dup',
        workspace: 'w',
        status: 'collecting',
        createdAt: '2026-11-21T00:00:00.000Z',
      },
      {
        id: 'second',
        runId: 'run-dup',
        workspace: 'w',
        status: 'collecting',
        createdAt: '2026-11-21T00:01:00.000Z',
      },
      {
        id: 'other',
        runId: 'run-other',
        workspace: 'w',
        status: 'collecting',
        createdAt: '2026-11-21T00:02:00.000Z',
      },
    ]);
    await old.insert(schema.incidentEvents).values([
      { incidentId: 'first', seq: 1, step: 'collect', kind: 'status', title: 'collecting' },
      { incidentId: 'second', seq: 1, step: 'collect', kind: 'status', title: 'collecting' },
    ]);
    client.close();

    const db = await openDb(url);
    const ids = (await db.select({ id: schema.incidents.id }).from(schema.incidents)).map((r) => r.id).sort();
    expect(ids).toEqual(['first', 'other']);
    const events = await db
      .select({ incidentId: schema.incidentEvents.incidentId })
      .from(schema.incidentEvents);
    expect(events).toEqual([{ incidentId: 'first' }]);
  });
});
