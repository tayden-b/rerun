import { describe, expect, it } from 'vitest';
import { diffLines, diffStat } from '@/lib/ui/diff';
import { buildIncidentView } from '@/lib/ui/incident-view';
import { getDb } from '@/src/db';
import { getIncident } from '@/src/db/incidents';
import { seedDemo } from '@/scripts/seed-demo';

describe('diffLines', () => {
  it('returns hunks with context around a one-line change', () => {
    const rows = diffLines('a\nb\nc\nd\n', 'a\nb\nC\nd\n', 1);
    expect(rows.map((r) => r.type)).toEqual(['hunk', 'context', 'removed', 'added', 'context']);
    expect(rows[0]).toEqual({ type: 'hunk', text: '@@ -2 +2 @@' });
    expect(diffStat(rows)).toEqual({ added: 1, removed: 1 });
  });

  it('treats a new file as all additions', () => {
    expect(diffStat(diffLines(null, 'x\ny\n'))).toEqual({ added: 2, removed: 0 });
  });
});

describe('buildIncidentView on seeded demo data', () => {
  it('derives triage, two subagents, patch, verify and PR for the awaiting incident', async () => {
    const db = await getDb('file::memory:');
    await seedDemo(db);
    const detail = await getIncident(db, 'demo-awaiting-approval');
    expect(detail?.status).toBe('awaiting_approval');
    const view = buildIncidentView(detail!);
    expect(view.triage?.failureClass.choice).toBe('apply_runtime');
    expect(view.subagents.map((s) => [s.agent, s.state, s.tools.length])).toEqual([
      ['config', 'done', 3],
      ['reality', 'done', 3],
    ]);
    expect(view.patch?.files[0].path).toBe('main.tf');
    expect(view.verify?.ok).toBe(true);
    expect(view.pr?.number).toBe(12);
    expect(view.title).toBe('Stop the announce provisioner from exiting 1');
    expect(view.steps.find((s) => s.step === 'await')?.state).toBe('running');
    expect(view.steps.find((s) => s.step === 'confirm')?.state).toBe('pending');
    expect(view.usage[0].inputTokens).toBeGreaterThan(0);
  });

  it('marks every step done for the resolved incident', async () => {
    const db = await getDb('file::memory:');
    await seedDemo(db);
    const view = buildIncidentView((await getIncident(db, 'demo-resolved'))!);
    expect(view.steps.every((s) => s.state === 'done')).toBe(true);
  });
});

describe('buildIncidentView step recovery', () => {
  it('shows a step as done once a retry succeeds after an error', async () => {
    const db = await getDb('file::memory:');
    await seedDemo(db);
    const detail = (await getIncident(db, 'demo-awaiting-approval'))!;
    const verify = detail.events.findIndex((e) => e.step === 'verify');
    const retried = {
      ...detail.events[verify],
      kind: 'error' as const,
      payload: { message: 'plan timed out' },
    };
    const events = [...detail.events.slice(0, verify), retried, ...detail.events.slice(verify)];
    const stepState = (evts: typeof events) =>
      buildIncidentView({ ...detail, events: evts }).steps.find((s) => s.step === 'verify')?.state;
    expect(stepState(events)).toBe('done');
    expect(stepState([...detail.events.slice(0, verify), retried])).toBe('error');
  });
});
