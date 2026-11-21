import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from './index';
import {
  addArtifact,
  addDecision,
  appendEvent,
  createIncident,
  getIncident,
  listIncidents,
  setStatus,
} from './incidents';

let db: Db;

beforeEach(async () => {
  db = await openDb('file::memory:');
});

describe('incidents repository', () => {
  it('appends events with per-incident seq and returns them in order', async () => {
    const a = await createIncident(db, { runId: 'run-a', workspace: 'rerun-fixtures' });
    const b = await createIncident(db, { runId: 'run-b', workspace: 'rerun-fixtures' });

    await appendEvent(db, a.id, { step: 'collect', kind: 'tool_call', title: 'get_run_details' });
    await appendEvent(db, b.id, { step: 'collect', kind: 'tool_call', title: 'other incident' });
    await appendEvent(db, a.id, {
      step: 'collect',
      kind: 'tool_result',
      title: 'run',
      payload: { ok: true },
    });
    const third = await appendEvent(db, a.id, { step: 'triage', kind: 'decision', title: 'jev' });
    expect(third.seq).toBe(3);

    const detail = await getIncident(db, a.id);
    expect(detail?.events.map((e) => [e.seq, e.title])).toEqual([
      [1, 'get_run_details'],
      [2, 'run'],
      [3, 'jev'],
    ]);
    expect(detail?.events[1].payload).toEqual({ ok: true });
    expect((await getIncident(db, b.id))?.events.map((e) => e.seq)).toEqual([1]);
  });

  it('assigns unique seqs under concurrent appends', async () => {
    const inc = await createIncident(db, { runId: 'run-c', workspace: 'rerun-fixtures' });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        appendEvent(db, inc.id, { step: 'diagnose:config', kind: 'agent_step', title: `step ${i}` }),
      ),
    );
    const detail = await getIncident(db, inc.id);
    expect(detail?.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('persists status changes and stamps resolvedAt', async () => {
    const inc = await createIncident(db, { runId: 'run-d', workspace: 'rerun-fixtures' });
    expect(inc.status).toBe('collecting');
    expect(inc.needsHuman).toBe(false);

    await setStatus(db, inc.id, 'awaiting_approval', { route: 'autoPr', prNumber: 7 });
    let detail = await getIncident(db, inc.id);
    expect(detail?.status).toBe('awaiting_approval');
    expect(detail?.route).toBe('autoPr');
    expect(detail?.prNumber).toBe(7);
    expect(detail?.resolvedAt).toBeNull();

    await setStatus(db, inc.id, 'resolved');
    detail = await getIncident(db, inc.id);
    expect(detail?.status).toBe('resolved');
    expect(detail?.resolvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const firstResolvedAt = detail?.resolvedAt;
    await new Promise((r) => setTimeout(r, 5));
    await setStatus(db, inc.id, 'resolved');
    expect((await getIncident(db, inc.id))?.resolvedAt).toBe(firstResolvedAt);
  });

  it('throws when setting status on a missing incident', async () => {
    await expect(setStatus(db, 'nope', 'failed')).rejects.toThrow(/not found/);
  });

  it('returns decisions and artifacts with the incident', async () => {
    const inc = await createIncident(db, { runId: 'run-e', workspace: 'rerun-fixtures' });
    await addDecision(db, inc.id, {
      provider: 'recorded',
      request: { q: 1 },
      response: { a: 2 },
      inputTokens: 120,
      latencyMs: 5,
    });
    await addArtifact(db, inc.id, { type: 'log', name: 'apply.log', content: 'Error: boom' });

    const detail = await getIncident(db, inc.id);
    expect(detail?.decisions).toHaveLength(1);
    expect(JSON.parse(detail!.decisions[0].responseJson)).toEqual({ a: 2 });
    expect(detail?.artifacts.map((a) => [a.type, a.name])).toEqual([['log', 'apply.log']]);
  });

  it('redacts secrets before storing events, decisions, and artifacts', async () => {
    const ghToken = `ghp_${'a'.repeat(36)}`;
    const antKey = `sk-ant-${'b'.repeat(24)}`;
    const inc = await createIncident(db, { runId: 'run-g', workspace: 'rerun-fixtures' });
    await appendEvent(db, inc.id, {
      step: 'collect',
      kind: 'tool_result',
      title: `token ${ghToken}`,
      payload: { header: 'Authorization: Bearer abcdefghijkl', key: antKey },
    });
    await addDecision(db, inc.id, {
      provider: 'llm',
      request: { prompt: `use ${antKey}` },
      response: { echo: ghToken },
      inputTokens: 1,
      latencyMs: 1,
    });
    await addArtifact(db, inc.id, { type: 'log', name: 'apply.log', content: `Error: ${ghToken}` });

    const detail = await getIncident(db, inc.id);
    const stored = JSON.stringify(detail);
    expect(stored).not.toContain(ghToken);
    expect(stored).not.toContain(antKey);
    expect(stored).not.toContain('abcdefghijkl');
    expect(detail?.events[0].title).toBe('token [REDACTED:github_token]');
    expect(detail?.events[0].payload).toEqual({
      header: 'Authorization: Bearer [REDACTED:bearer]',
      key: '[REDACTED:anthropic_key]',
    });
    expect(JSON.parse(detail!.decisions[0].requestJson)).toEqual({ prompt: 'use [REDACTED:anthropic_key]' });
    expect(detail?.artifacts[0].content).toBe('Error: [REDACTED:github_token]');
  });

  it('lists incidents newest first and returns null for unknown ids', async () => {
    await createIncident(db, { runId: 'old', workspace: 'w', createdAt: '2026-01-01T00:00:00.000Z' });
    await createIncident(db, { runId: 'new', workspace: 'w', createdAt: '2026-02-01T00:00:00.000Z' });
    expect((await listIncidents(db)).map((i) => i.runId)).toEqual(['new', 'old']);
    expect(await getIncident(db, 'missing')).toBeNull();
  });
});
