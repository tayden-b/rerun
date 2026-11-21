import { afterEach, describe, expect, it, vi } from 'vitest';
import * as incidentsDb from '../../src/db/incidents';
import { runIdForScenario } from '../../src/incident/demo';
import { startIncident } from '../../src/incident/start';
import { startHarness, type Harness } from './helpers';

// Simulates another process (poller, webhook, live eval) inserting the same run between
// startIncident's lookup and its insert.
vi.mock('../../src/db/incidents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/incidents')>();
  return {
    ...actual,
    createIncident: vi.fn(async (...[db, input]: Parameters<typeof actual.createIncident>) => {
      if (race.enabled) {
        race.enabled = false;
        race.winner = await actual.createIncident(db, { ...input, id: 'other-process' });
      }
      return actual.createIncident(db, input);
    }),
  };
});

const race: { enabled: boolean; winner?: incidentsDb.Incident } = { enabled: false };

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  race.enabled = false;
  race.winner = undefined;
});

const RUN = runIdForScenario('apply-time-exit-1');

describe('startIncident across processes', () => {
  it('rejects a second incident row for the same run (unique index on run_id)', async () => {
    h = await startHarness();
    await incidentsDb.createIncident(h.db, { runId: RUN, workspace: 'rerun-fixtures' });
    await expect(
      incidentsDb.createIncident(h.db, { runId: RUN, workspace: 'rerun-fixtures' }),
    ).rejects.toThrow();
  });

  it('treats a unique violation as already started and starts no workflow', async () => {
    h = await startHarness();
    race.enabled = true;
    const result = await startIncident(RUN);
    expect(result.created).toBe(false);
    expect(result.incident.id).toBe('other-process');
    expect(h.runs).toHaveLength(0);
    expect(await incidentsDb.listIncidents(h.db)).toHaveLength(1);
  });
});
