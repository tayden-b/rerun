import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRunArtifacts, determineStage, type CollectEvent } from '../../src/mcp/collect';
import { FIXTURES_DIR, type MockServerHandle } from '../../src/mcp/mock/server';
import { connect, startMock } from './helpers';

let server: MockServerHandle;
beforeAll(async () => {
  server = await startMock();
});
afterAll(() => server.close());

function expected(scenario: string): { stage: string } {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, scenario, 'expected.json'), 'utf8')) as {
    stage: string;
  };
}

const cases = [
  {
    scenario: 'apply-time-exit-1',
    runId: 'run-PLACEHOLDER0001',
    excerpt: 'local-exec provisioner error',
    tools: [
      'get_workspace_details',
      'get_run_details',
      'get_plan_details',
      'get_plan_logs',
      'get_plan_json_output',
      'get_apply_details',
      'get_apply_logs',
      'get_state_version',
    ],
  },
  {
    scenario: 'undeclared-reference',
    runId: 'run-PLACEHOLDER0002',
    excerpt: 'Reference to undeclared resource',
    tools: [
      'get_workspace_details',
      'get_run_details',
      'get_plan_details',
      'get_plan_logs',
      'get_apply_details',
      'get_state_version',
    ],
  },
];

describe('collectRunArtifacts against the mock server', () => {
  for (const c of cases) {
    it(`collects ${c.scenario}`, async () => {
      const mcp = await connect(server, c.scenario);
      const events: CollectEvent[] = [];
      const artifacts = await collectRunArtifacts(mcp, c.runId, async (e) => {
        await new Promise((r) => setTimeout(r, 1));
        events.push(e);
      });
      await mcp.close();

      expect(artifacts.stage).toBe(expected(c.scenario).stage);
      expect(artifacts.errorExcerpt).toContain(c.excerpt);
      expect(artifacts.run).toBeTruthy();
      expect(artifacts.workspace).toBeTruthy();
      expect(artifacts.stateVersion).toBeTruthy();
      expect(events.map((e) => `${e.kind}:${e.title}`)).toEqual(
        c.tools.flatMap((t) => [`tool_call:${t}`, `tool_result:${t}`]),
      );
      expect(events.every((e) => e.step === 'collect')).toBe(true);
    });
  }

  it('fails the collection when emitting an event fails', async () => {
    const mcp = await connect(server, 'undeclared-reference');
    let calls = 0;
    const failure = new Error('db down');
    await expect(
      collectRunArtifacts(mcp, 'run-PLACEHOLDER0002', () => {
        calls += 1;
        if (calls === 2) return Promise.reject(failure);
        return undefined;
      }),
    ).rejects.toBe(failure);
    await mcp.close();
    expect(calls).toBe(2);
  });

  it('keeps signed log URLs out of event payloads', async () => {
    const mcp = await connect(server, 'apply-time-exit-1');
    const events: CollectEvent[] = [];
    await collectRunArtifacts(mcp, 'run-PLACEHOLDER0001', (e) => {
      events.push(e);
    });
    await mcp.close();
    const planDetails = events.find((e) => e.kind === 'tool_result' && e.title === 'get_plan_details');
    expect(JSON.stringify(planDetails?.payload)).toContain('[REDACTED:signed_url]');
  });

  it('renders structured diagnostics in CLI form', async () => {
    const mcp = await connect(server, 'undeclared-reference');
    const artifacts = await collectRunArtifacts(mcp, 'run-PLACEHOLDER0002');
    await mcp.close();
    expect(artifacts.planLogs).toContain('│ Error: Reference to undeclared resource');
    expect(artifacts.planLogs).toContain('on main.tf line 41');
    expect(artifacts.planJson).toBeUndefined();
    expect(artifacts.applyLogs).toBeUndefined();
  });
});

describe('determineStage', () => {
  const run = (ts: Record<string, string>) => ({ data: { attributes: { 'status-timestamps': ts } } });
  it('uses the failing command HCP Terraform reports', () => {
    expect(
      determineStage({
        run: run({}),
        planStatus: 'errored',
        planLog:
          'Error: Unreadable module directory\nOperation failed: failed running terraform init (exit 1)',
      }),
    ).toBe('init');
    expect(
      determineStage({
        run: run({}),
        planStatus: 'errored',
        planLog: 'Operation failed: failed running terraform plan (exit 1)',
      }),
    ).toBe('plan');
  });
  it('falls back to the errored phase, then the run timestamps', () => {
    expect(determineStage({ run: run({}), planStatus: 'finished', applyStatus: 'errored' })).toBe('apply');
    expect(determineStage({ run: run({}), planStatus: 'errored', applyStatus: 'unreachable' })).toBe('plan');
    expect(determineStage({ run: run({ 'applying-at': '2026-11-20T00:00:00Z' }) })).toBe('apply');
    expect(determineStage({ run: run({}) })).toBe('plan');
  });
});
