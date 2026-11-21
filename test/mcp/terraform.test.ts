import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRY_TOOLS } from '../../src/mcp/allowlist';
import { ToolNotAllowedError, WorkspaceScopeError } from '../../src/mcp/errors';
import type { MockServerHandle } from '../../src/mcp/mock/server';
import type { TerraformMcp, ToolObserverEvent } from '../../src/mcp/terraform';
import { connect, startMock } from './helpers';

let server: MockServerHandle;
let mcp: TerraformMcp;
const events: ToolObserverEvent[] = [];
let traced: TerraformMcp;

beforeAll(async () => {
  server = await startMock();
  mcp = await connect(server, 'apply-time-exit-1');
  traced = mcp.withObserver((e) => events.push(e));
});
afterAll(async () => {
  await mcp.close();
  await server.close();
});

describe('scoped Terraform MCP client', () => {
  it('refuses another workspace before any call is made', async () => {
    events.length = 0;
    await expect(traced.listRuns({ workspace: 'prod-network' })).rejects.toBeInstanceOf(WorkspaceScopeError);
    await expect(traced.getWorkspaceDetails({ workspace: 'prod-network' })).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
    await expect(
      traced.call('list_state_versions', { workspace_name: 'prod-network' }),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    await expect(traced.call('list_runs', { terraform_org_name: 'other-org' })).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
    expect(events).toEqual([]);
  });

  it('refuses plans and applies that no verified run of the workspace owns', async () => {
    events.length = 0;
    await expect(traced.getPlanLogs('plan-SOMEONEELSE')).rejects.toBeInstanceOf(WorkspaceScopeError);
    await expect(traced.getApplyLogs('apply-SOMEONEELSE')).rejects.toBeInstanceOf(WorkspaceScopeError);
    expect(events).toEqual([]);
  });

  it('refuses tools outside the allowlist', async () => {
    await expect(mcp.call('create_run', { workspace_id: 'ws-1' })).rejects.toBeInstanceOf(
      ToolNotAllowedError,
    );
    await expect(mcp.call('apply_run')).rejects.toBeInstanceOf(ToolNotAllowedError);
  });

  it('injects the org and workspace into workspace-bearing calls', async () => {
    events.length = 0;
    const res = await traced.listRuns({ pageSize: 20 });
    expect(res.runs.map((r) => r.id)).toContain('run-PLACEHOLDER0001');
    expect(events[0]).toMatchObject({
      phase: 'call',
      tool: 'list_runs',
      args: { terraform_org_name: 'hashi-org-TF', workspace_name: 'rerun-fixtures', pageSize: 20 },
    });
  });

  it('unlocks plan and apply calls once the run is verified in the workspace', async () => {
    await mcp.getRunDetails('run-PLACEHOLDER0001');
    const logs = await mcp.getApplyLogs('apply-PLACEHOLDER01');
    expect(logs.data).toMatchObject({
      text: expect.stringContaining('local-exec provisioner error') as unknown,
    });
    const plan = await mcp.getPlanDetails('plan-PLACEHOLDER01');
    expect(plan.data).toMatchObject({ data: { attributes: { status: 'finished' } } });
  });

  it('parses JSON text and wraps plain text', async () => {
    const who = await mcp.whoami();
    expect(who.data).toMatchObject({ username: 'rerun-recorder' });
    expect(who.raw.content).toHaveLength(1);
  });

  it('tools() exposes only the registry toolset', async () => {
    const tools = await mcp.tools();
    expect(Object.keys(tools).sort()).toEqual([...REGISTRY_TOOLS].sort());
  });
});
