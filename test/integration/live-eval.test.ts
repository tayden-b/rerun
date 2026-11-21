import { afterEach, describe, expect, it } from 'vitest';
import { createLiveScenarioRunner, liveAppUrl, startIncidentViaApp } from '../../evals/live';
import { fixturesDriver } from '../../evals/liveFixtures';
import { POST } from '../../app/api/incidents/route';
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

describe('startIncidentViaApp', () => {
  // Live failure: `start()` from `workflow/api` in the `npm run eval` process (not compiled by Next) throws
  // "'start' received an invalid workflow function", so the CLI starts incidents through the app.
  it('POSTs the run id to /api/incidents and returns the incident', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json({ incident: { id: 'i1' }, created: true }, { status: 201 });
    }) as typeof fetch;
    const result = await startIncidentViaApp('http://localhost:3000', 'run-abc', fetchFn);
    expect(result).toEqual({ incident: { id: 'i1' }, created: true });
    expect(calls[0].url).toBe('http://localhost:3000/api/incidents');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ runId: 'run-abc' });
  });

  it('throws on an HTTP error', async () => {
    const fetchFn = (async () => new Response('nope', { status: 400 })) as typeof fetch;
    await expect(startIncidentViaApp('http://localhost:3000', 'run-abc', fetchFn)).rejects.toThrow(
      /HTTP 400/,
    );
  });
});

describe('POST /api/incidents', () => {
  it('starts the incident once and returns the existing one after', async () => {
    h = await startHarness();
    const run = runIdForScenario('apply-time-exit-1');
    const post = (body: unknown) =>
      POST(new Request('http://localhost/api/incidents', { method: 'POST', body: JSON.stringify(body) }));
    const first = await post({ runId: run });
    expect(first.status).toBe(201);
    const second = await post({ runId: run });
    expect(second.status).toBe(200);
    expect((await second.json()).incident.id).toBe((await first.json()).incident.id);
    expect(h.runs).toHaveLength(1);
    await h.runs[0];
    expect((await post({ runId: '../x' })).status).toBe(400);
  });
});

describe('live eval guards', () => {
  it('treats a blank RERUN_APP_URL as unset', () => {
    expect(liveAppUrl({ RERUN_APP_URL: '', PORT: '' })).toBe('http://localhost:3000');
    expect(liveAppUrl({ RERUN_APP_URL: 'http://app.test' })).toBe('http://app.test');
  });

  it('refuses to drive the fixtures scripts in demo mode', () => {
    expect(() => fixturesDriver({ mcp: async () => ({}) as never })).toThrow(/RERUN_MODE=live/);
  });

  it('keeps waiting when one incident read fails instead of cleaning up mid-incident', async () => {
    let reads = 0;
    const cleanups: (string | undefined)[] = [];
    const run = createLiveScenarioRunner({
      runIdFor: () => 'run-x',
      start: async () => ({ incident: { id: 'i1' } }),
      load: async () => {
        reads += 1;
        if (reads === 2) throw new Error('Failed query: select ... from incident_events');
        return { status: reads === 1 ? 'collecting' : 'awaiting_approval', events: [] } as never;
      },
      expected: () => expected,
      cleanup: async (detail) => void cleanups.push(detail?.status),
      pollMs: 1,
    });
    expect(await run('x')).toMatchObject({ reachedStatus: 'awaiting_approval' });
    expect(reads).toBe(3);
    expect(cleanups).toEqual(['awaiting_approval']);
  });
});
