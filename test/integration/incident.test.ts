import { afterEach, describe, expect, it } from 'vitest';
import { getIncident } from '../../src/db/incidents';
import { approvalToken, runIncidentPipeline } from '../../src/incident/pipeline';
import { incidentServices } from '../../src/incident/services';
import { startIncident } from '../../src/incident/start';
import { FakeGitHub } from '../../src/github/fake';
import { approveImmediately, pipelineSteps, startHarness, type Harness } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const RUN = 'run-PLACEHOLDER0001';

describe('incident workflow (demo mode, inline)', () => {
  it('takes apply-time-exit-1 from errored run to resolved', async () => {
    h = await startHarness();
    const { incident, created } = await startIncident(RUN);
    expect(created).toBe(true);
    expect(await h.runs[0]).toBe('confirmed');

    const detail = (await getIncident(h.db, incident.id))!;
    expect(detail.status).toBe('resolved');
    expect(detail.failureClass).toBe('apply_runtime');
    expect(detail.route).toBe('autoPr');
    expect(detail.prNumber).toBe(1);
    expect(detail.decisions).toHaveLength(1);
    expect(detail.artifacts.map((a) => a.type).sort()).toEqual(
      ['diff', 'log', 'log', 'plan_json', 'pr_body', 'verify_output'].sort(),
    );

    const statuses = detail.events.filter((e) => e.kind === 'status' && !e.title.endsWith('completed'));
    expect(statuses.map((e) => e.title)).toEqual([
      'collecting',
      'triaging',
      'triaging',
      'diagnosing',
      'fixing',
      'verifying',
      'proposing',
      'awaiting_approval',
      'merged',
      'confirming',
      'resolved',
    ]);
    const steps = new Set(detail.events.map((e) => e.step));
    for (const s of [
      'collect',
      'triage',
      'diagnose:config',
      'diagnose:reality',
      'fix',
      'verify',
      'propose',
      'await',
      'confirm',
    ]) {
      expect(steps).toContain(s);
    }
    const toolCall = detail.events.find((e) => e.step === 'diagnose:config' && e.kind === 'tool_call');
    expect(toolCall?.payload).toMatchObject({ tool: 'grep_log', args: { log: 'apply' } });
    const usage = detail.events.filter((e) => (e.payload as { usage?: { model?: string } })?.usage?.model);
    expect(usage.length).toBe(3);

    const github = incidentServices().github('apply-time-exit-1') as FakeGitHub;
    const pr = github.pulls.get(1)!;
    expect(pr.branch).toBe(`rerun/fix-${RUN}`);
    expect(pr.state).toBe('merged');
    expect(github.filesAt('main')['main.tf']).toContain('command = "echo bootstrapping rerun-fixtures"\n');
  });

  it('dedupes on runId and replays completed steps without a second branch or PR', async () => {
    h = await startHarness();
    const [a, b] = await Promise.all([startIncident(RUN), startIncident(RUN)]);
    expect(a.incident.id).toBe(b.incident.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    await h.runs[0];
    expect(h.runs).toHaveLength(1);

    const before = (await getIncident(h.db, a.incident.id))!;
    expect(await runIncidentPipeline(a.incident.id, RUN, pipelineSteps, approveImmediately)).toBe(
      'confirmed',
    );
    const after = (await getIncident(h.db, a.incident.id))!;
    expect(after.events).toHaveLength(before.events.length);
    expect(after.decisions).toHaveLength(1);
    const github = incidentServices().github('apply-time-exit-1') as FakeGitHub;
    expect(github.pulls.size).toBe(1);
    expect([...github.branches.keys()].filter((b) => b.startsWith('rerun/'))).toHaveLength(1);
  });

  it('runs one agent for a plan-stage config_reference failure', async () => {
    h = await startHarness();
    const { incident } = await startIncident('run-PLACEHOLDER0002');
    await h.runs[0];
    const detail = (await getIncident(h.db, incident.id))!;
    expect(detail.status).toBe('resolved');
    expect(detail.events.some((e) => e.step === 'diagnose:reality')).toBe(false);
  });

  it('retries the fix once, then hands a twice-failed verification to a human', async () => {
    const failing = {
      name: 'fake' as const,
      verify: async () => {
        const step = { ok: false, exitCode: 1, stdout: '', stderr: 'Error: still broken', durationMs: 1 };
        return {
          ok: false,
          fmt: { ...step, ok: true, exitCode: 0 },
          validate: step,
          plan: step,
          summary: 'validate failed',
        };
      },
    };
    h = await startHarness({ override: { verifier: () => failing } });
    const { incident } = await startIncident(RUN);
    expect(await h.runs[0]).toBe('needs_human');
    const detail = (await getIncident(h.db, incident.id))!;
    expect(detail.status).toBe('needs_human');
    expect(detail.events.filter((e) => e.title === 'Fix agent retry with verifier output')).toHaveLength(1);
    expect(detail.artifacts.filter((a) => a.type === 'verify_output')).toHaveLength(2);
    expect(detail.prNumber).toBeNull();
  });

  it('opens a linked incident when the next run errors', async () => {
    h = await startHarness({
      override: {
        runLister: () => ({
          listRuns: async () => [
            { id: RUN, status: 'errored', createdAt: '2026-11-20T15:02:11Z' },
            { id: 'run-PLACEHOLDER0002', status: 'errored', createdAt: '2026-11-20T15:10:05Z' },
          ],
        }),
      },
    });
    const { incident } = await startIncident(RUN);
    await h.runs[0];
    const parent = (await getIncident(h.db, incident.id))!;
    expect(parent.status).toBe('needs_human');
    expect(h.runs).toHaveLength(2);
    await h.runs[1];
    const confirm = parent.events.find((e) => e.step === 'confirm' && e.title === 'needs_human');
    const childId = (confirm?.payload as { childIncidentId: string }).childIncidentId;
    expect((await getIncident(h.db, childId))?.parentIncidentId).toBe(incident.id);
  });

  it('uses a deterministic approval hook token', () => {
    expect(approvalToken('abc')).toBe('rerun:approve:abc');
  });
});
