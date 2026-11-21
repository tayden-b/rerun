import { describe, expect, it } from 'vitest';
import { seedDemo } from '../../scripts/seed-demo';
import { openDb } from '../../src/db';
import { createIncident, getIncident, listIncidents } from '../../src/db/incidents';
import { incidents } from '../../src/db/schema';

describe('seedDemo', () => {
  // `npm run demo` starts a workflow incident for the same recorded run the seed uses; with
  // `incidents.run_id` unique, seeding afterwards must replace it rather than fail.
  it('replaces an incident another process created for a seeded run', async () => {
    const db = await openDb('file::memory:');
    const count = await seedDemo(db);
    const runId = (await getIncident(db, 'demo-awaiting-approval'))!.runId;
    await db.delete(incidents);
    await createIncident(db, { id: 'from-demo-workflow', runId, workspace: 'rerun-fixtures' });
    await expect(seedDemo(db)).resolves.toBe(count);
    const ids = (await listIncidents(db)).map((i) => i.id);
    expect(ids).toHaveLength(count);
    expect(ids).not.toContain('from-demo-workflow');
  });

  it('refuses to delete an incident for a seeded run outside demo mode', async () => {
    const db = await openDb('file::memory:');
    await seedDemo(db);
    const runId = (await getIncident(db, 'demo-awaiting-approval'))!.runId;
    await db.delete(incidents);
    await createIncident(db, { id: 'live-investigation', runId, workspace: 'rerun-fixtures' });
    await expect(seedDemo(db, Date.now(), 'live')).rejects.toThrow(/live-investigation/);
    expect((await listIncidents(db)).map((i) => i.id)).toEqual(['live-investigation']);
  });
});
