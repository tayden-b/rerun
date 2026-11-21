import { describe, expect, it } from 'vitest';
import { WorkspaceScopeError } from '../../src/mcp/errors';
import { createTerraformMcp } from '../../src/mcp/terraform';

// Live integration: runs only when TFE_TOKEN/TFE_ORG are set and the real server
// (`docker compose up terraform-mcp`) listens on TERRAFORM_MCP_URL. Never in CI.
const live = Boolean(process.env.TFE_TOKEN && process.env.TFE_ORG);
const url = process.env.TERRAFORM_MCP_URL ?? 'http://127.0.0.1:8080/mcp';
const workspace = process.env.RERUN_WORKSPACE ?? 'rerun-fixtures';

describe.runIf(live)('Terraform MCP client against the real server', () => {
  const open = () => createTerraformMcp({ url, workspace, org: process.env.TFE_ORG ?? '' });

  it('whoami succeeds and listRuns returns an array for the scoped workspace', async () => {
    const mcp = await open();
    const who = await mcp.whoami();
    expect(who.raw.isError).toBeFalsy();
    const { runs } = await mcp.listRuns({ pageSize: 5 });
    expect(Array.isArray(runs)).toBe(true);
    await mcp.close();
  });

  it('lists workspaces but refuses details for any other name', async () => {
    const mcp = await open();
    const listed = await mcp.call('list_workspaces', { pageSize: 100 });
    const names = [...listed.text.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    const others = [...new Set([...names.filter((n) => n !== workspace), 'not-rerun-fixtures'])];
    for (const name of others) {
      await expect(mcp.getWorkspaceDetails({ workspace: name })).rejects.toBeInstanceOf(WorkspaceScopeError);
    }
    await mcp.close();
  }, 30_000);
});
