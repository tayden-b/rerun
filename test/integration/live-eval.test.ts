import { afterEach, describe, expect, it } from 'vitest';
import { createLiveScenarioRunner } from '../../evals/live';
import { getIncident } from '../../src/db/incidents';
import { runIdForScenario } from '../../src/incident/demo';
import { startIncident } from '../../src/incident/start';
import { startHarness, type Harness } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const expected = { fixTouches: ['main.tf'], mustNotTouch: ['outputs.tf'] };

describe('runLiveScenario', () => {
  it('drives startIncident to a settled status and reports verifier, PR and fixTouches', async () => {
    h = await startHarness({ awaitApproval: async (_id, ready) => (await ready(), new Promise(() => {})) });
    const db = h.db;
    const run = createLiveScenarioRunner({
      runIdFor: runIdForScenario,
      start: startIncident,
      load: (id) => getIncident(db, id),
      expected: () => expected,
      pollMs: 10,
    });
    const result = await run('apply-time-exit-1');
    expect(result).toMatchObject({
      reachedStatus: 'awaiting_approval',
      verifierOk: true,
      prUrl: 'https://github.com/tayden-b/rerun-fixtures/pull/1',
      fixTouchesRespected: true,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports fixTouches violations and gives up at the timeout', async () => {
    let t = 0;
    const run = createLiveScenarioRunner({
      runIdFor: () => 'run-x',
      start: async () => ({ incident: { id: 'i1' } as never }),
      load: async () =>
        ({
          status: 'verifying',
          prUrl: 'https://example.test/pr/1',
          events: [
            { payload: { completed: 'fix', result: { patch: { files: [{ path: 'outputs.tf' }] } } } },
            { payload: { completed: 'verify', result: { ok: false } } },
          ],
        }) as never,
      expected: () => expected,
      timeoutMs: 5,
      pollMs: 1,
      now: () => (t += 3),
    });
    expect(await run('x')).toMatchObject({
      reachedStatus: 'verifying',
      verifierOk: false,
      fixTouchesRespected: false,
    });
  });
});
