import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './index';
import { createIncident, listIncidents } from './incidents';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

// Another process (the app, while the live eval polls the same file) holds the write lock for 500 ms.
const HOLD_LOCK = `
const { createClient } = require('@libsql/client');
(async () => {
  const tx = await createClient({ url: process.argv[1] }).transaction('write');
  await tx.execute("UPDATE incidents SET status = 'failed' WHERE 0");
  process.stdout.write('locked\\n');
  setTimeout(() => tx.commit().then(() => process.exit(0)), 500);
})();
`;

describe('openDb on a file shared with another process', () => {
  // Live failure: `npm run eval -- --live` hit the DB while the app held the write lock and got
  // "Failed query: ..." (SQLITE_BUSY) instead of waiting for the lock.
  it('waits for another process to release its write lock', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rerun-busy-'));
    const url = `file:${path.join(dir, 'rerun.db')}`;
    const db = await openDb(url);
    const holder = spawn(process.execPath, ['-e', HOLD_LOCK, url], { stdio: ['ignore', 'pipe', 'inherit'] });
    await once(holder.stdout, 'data');
    await createIncident(db, { runId: 'run-busy', workspace: 'rerun-fixtures' });
    expect(await listIncidents(db)).toHaveLength(1);
    await once(holder, 'exit');
  });
});
