import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTRY_TOOLS } from '../../src/mcp/allowlist';
import { ToolNotAllowedError, WorkspaceScopeError } from '../../src/mcp/errors';
import { FIXTURES_DIR, startMockServer, type MockServerHandle } from '../../src/mcp/mock/server';
import { createTerraformMcp, type TerraformMcp, type ToolObserverEvent } from '../../src/mcp/terraform';
import { connect, ORG, startMock, WORKSPACE } from './helpers';

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

describe('scope checks that need the server', () => {
  let dir: string;
  let foreign: MockServerHandle;
  let client: TerraformMcp;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'rerun-scope-'));
    const mcpDir = path.join(dir, 'foreign', 'mcp');
    mkdirSync(mcpDir, { recursive: true });
    copyFileSync(
      path.join(FIXTURES_DIR, 'apply-time-exit-1', 'mcp', 'get_workspace_details.json'),
      path.join(mcpDir, 'get_workspace_details.json'),
    );
    writeFileSync(
      path.join(mcpDir, 'get_run_details.json'),
      JSON.stringify({
        result: {
          data: {
            id: 'run-FOREIGN',
            type: 'runs',
            attributes: { status: 'errored', message: 'secret prod change' },
            relationships: { workspace: { data: { id: 'ws-OTHER', type: 'workspaces' } } },
          },
        },
      }),
    );
    foreign = await startMockServer({ port: 0, fixturesDir: dir, scenario: 'foreign' });
    client = await createTerraformMcp({ url: foreign.url, org: ORG, workspace: WORKSPACE });
  });
  afterAll(async () => {
    await client.close();
    await foreign.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('never publishes a run from another workspace to observers', async () => {
    const seen: ToolObserverEvent[] = [];
    await expect(
      client.withObserver((e) => seen.push(e)).getRunDetails('run-FOREIGN'),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    const runEvents = seen.filter((e) => e.tool === 'get_run_details');
    expect(runEvents.map((e) => e.phase)).toEqual(['call', 'error']);
    expect(JSON.stringify(seen)).not.toContain('secret prod change');
  });

  it('rejects conflicting scope arguments on run and state calls', async () => {
    const seen: ToolObserverEvent[] = [];
    const traced = client.withObserver((e) => seen.push(e));
    await expect(
      traced.call('get_run_details', { run_id: 'run-FOREIGN', workspace_name: 'prod-network' }),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    await expect(
      traced.call('get_run_comments', { run_id: 'run-FOREIGN', terraform_org_name: 'other-org' }),
    ).rejects.toBeInstanceOf(WorkspaceScopeError);
    expect(seen).toEqual([]);
    await expect(traced.call('get_state_version', { workspace_id: 'ws-OTHER' })).rejects.toBeInstanceOf(
      WorkspaceScopeError,
    );
    expect(seen.some((e) => e.tool === 'get_state_version')).toBe(false);
  });
});
