import { afterEach, describe, expect, it } from 'vitest';
import { getIncident } from '../../src/db/incidents';
import { approveIncident, IncidentActionError, requestChanges } from '../../src/incident/approval';
import { incidentServices } from '../../src/incident/services';
import { runIdForScenario } from '../../src/incident/demo';
import { startIncident } from '../../src/incident/start';
import { erroredRunFor, signBody, verifySignature } from '../../src/incident/webhook';
import { FakeGitHub } from '../../src/github/fake';
import { pollOnce, shouldPoll } from '../../src/poller';
import { loadConfig } from '../../src/config';
import { startHarness, type Harness } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const RUN = runIdForScenario('apply-time-exit-1');
const waitHere = (gate: Promise<void>) => async (_id: string, ready: () => Promise<void>) => {
  await ready();
  await gate;
  return { approvedBy: 'test', mergeSha: 'x' };
};

describe('webhook signature', () => {
  const body = JSON.stringify({
    run_id: RUN,
    workspace_name: 'rerun-fixtures',
    notifications: [{ trigger: 'run:errored' }],
  });
  it('accepts a good signature', () => {
    expect(verifySignature(body, signBody(body, 'secret'), 'secret')).toBe(true);
  });
  it('rejects a bad signature', () => {
    expect(verifySignature(body, signBody(body, 'other'), 'secret')).toBe(false);
    expect(verifySignature(body, 'abc', 'secret')).toBe(false);
  });
  it('rejects a missing signature', () => {
    expect(verifySignature(body, null, 'secret')).toBe(false);
  });
  it('accepts only run:errored for the workspace', () => {
    expect(erroredRunFor(JSON.parse(body), 'rerun-fixtures')).toBe(RUN);
    expect(erroredRunFor(JSON.parse(body), 'other')).toBeNull();
    expect(
      erroredRunFor(
        { run_id: RUN, workspace_name: 'rerun-fixtures', notifications: [{ trigger: 'run:completed' }] },
        'rerun-fixtures',
      ),
    ).toBeNull();
  });
});

describe('approve / request changes', () => {
  it('rejects approval before the incident awaits it, then merges and resumes', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    h = await startHarness({ awaitApproval: waitHere(gate) });
    const { incident } = await startIncident(RUN);
    await expect(approveIncident(incident.id)).rejects.toMatchObject({ status: 409 });
    for (
      let i = 0;
      i < 200 &&
      !['awaiting_approval', 'needs_human'].includes((await getIncident(h.db, incident.id))?.status ?? '');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const result = await approveIncident(incident.id);
    expect(result.status).toBe('merged');
    expect((await getIncident(h.db, incident.id))?.status).toBe('merged');
    await expect(approveIncident(incident.id)).rejects.toBeInstanceOf(IncidentActionError);
    open();
    await h.runs[0];
    expect((await getIncident(h.db, incident.id))?.status).toBe('resolved');
  });

  it('comments on the PR and sets needs_human', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    h = await startHarness({ awaitApproval: waitHere(gate) });
    const { incident } = await startIncident(RUN);
    for (
      let i = 0;
      i < 200 &&
      !['awaiting_approval', 'needs_human'].includes((await getIncident(h.db, incident.id))?.status ?? '');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await requestChanges(incident.id, '  keep the echo  ');
    expect((await getIncident(h.db, incident.id))?.status).toBe('needs_human');
    const github = incidentServices().github('apply-time-exit-1') as FakeGitHub;
    expect(github.pulls.get(1)?.comments.at(-1)).toContain('keep the echo');
    await expect(requestChanges('nope', 'x')).rejects.toMatchObject({ status: 404 });
    open();
    await h.runs[0];
  });
});

describe('poller', () => {
  it('is off when RERUN_POLL_SECONDS=0 and in demo without autoplay', () => {
    expect(shouldPoll(loadConfig({ RERUN_MODE: 'live', RERUN_POLL_SECONDS: '0' }), {})).toBe(false);
    expect(shouldPoll(loadConfig({ RERUN_MODE: 'demo' }), {})).toBe(false);
    expect(shouldPoll(loadConfig({ RERUN_MODE: 'demo' }), { RERUN_DEMO_AUTOPLAY: '1' })).toBe(true);
    expect(shouldPoll(loadConfig({ RERUN_MODE: 'live' }), {})).toBe(true);
  });

  it('starts one incident per new errored run', async () => {
    h = await startHarness();
    const seen = new Set<string>();
    const first = await pollOnce(seen, new Date(0));
    expect(first).toEqual(
      expect.arrayContaining([
        runIdForScenario('apply-time-exit-1'),
        runIdForScenario('undeclared-reference'),
      ]),
    );
    expect(await pollOnce(seen, new Date(0))).toEqual([]);
    await Promise.all(h.runs);
    expect(h.runs).toHaveLength(first.length);
  });
});

describe('review hardening', () => {
  it('redacts tokens in change-request comments before posting them', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    h = await startHarness({ awaitApproval: waitHere(gate) });
    const { incident } = await startIncident(RUN);
    for (
      let i = 0;
      i < 200 &&
      !['awaiting_approval', 'needs_human'].includes((await getIncident(h.db, incident.id))?.status ?? '');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await requestChanges(incident.id, 'use Bearer abcdefghijklmnopqrstuvwxyz0123456789 here');
    const github = incidentServices().github('apply-time-exit-1') as FakeGitHub;
    expect(github.pulls.get(1)?.comments.at(-1)).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    open();
    await h.runs[0];
  });

  it('retries resuming the workflow from merged without merging again', async () => {
    let fail = true;
    h = await startHarness({
      awaitApproval: waitHere(new Promise(() => {})),
      override: {
        resumeApproval: async () => {
          if (fail) throw new Error('world unavailable');
          return true;
        },
      },
    });
    const { incident } = await startIncident(RUN);
    for (let i = 0; i < 200 && (await getIncident(h.db, incident.id))?.status !== 'awaiting_approval'; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await expect(approveIncident(incident.id)).rejects.toThrow('world unavailable');
    expect((await getIncident(h.db, incident.id))?.status).toBe('merged');
    fail = false;
    const retried = await approveIncident(incident.id);
    expect(retried.resumed).toBe(true);
    const github = incidentServices().github('apply-time-exit-1') as FakeGitHub;
    expect(github.pulls.get(1)?.state).toBe('merged');
  });

  it('retries a failed workflow dispatch on the next trigger', async () => {
    let calls = 0;
    h = await startHarness({
      override: {
        startWorkflow: async () => {
          calls += 1;
          if (calls === 1) throw new Error('dispatch failed');
          return 'ok';
        },
      },
    });
    await expect(startIncident(RUN)).rejects.toThrow('dispatch failed');
    const again = await startIncident(RUN);
    expect(again.created).toBe(true);
    expect(calls).toBe(2);
  });
});
