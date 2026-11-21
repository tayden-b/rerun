import { describe, expect, it } from 'vitest';
import { loadConfig, requireLive } from '../../src/config';
import { WorkspaceScopeError } from '../../src/mcp/errors';
import { createTerraformMcp, type TerraformMcp } from '../../src/mcp/terraform';

// Needs TFE_ORG and the real server: `TFE_TOKEN=... docker compose up -d terraform-mcp`.
async function open(): Promise<{ mcp: TerraformMcp; workspace: string }> {
  const cfg = requireLive(['tfe'], loadConfig());
  try {
    const mcp = await createTerraformMcp({
      url: cfg.terraformMcpUrl,
      workspace: cfg.workspace,
      org: cfg.tfeOrg ?? '',
    });
    return { mcp, workspace: cfg.workspace };
  } catch (err) {
    throw new Error(
      `Terraform MCP server unreachable at ${cfg.terraformMcpUrl}; start it with \`docker compose up -d terraform-mcp\` (needs TFE_TOKEN). ${String(err)}`,
    );
  }
}

describe('Terraform MCP client against the real server', () => {
  it('whoami succeeds and listRuns returns an array for the scoped workspace', async () => {
    const { mcp } = await open();
    const who = await mcp.whoami();
    expect(who.raw.isError).toBeFalsy();
    const { runs } = await mcp.listRuns({ pageSize: 5 });
    expect(Array.isArray(runs)).toBe(true);
    await mcp.close();
  });

  it('lists workspaces but refuses details for any other name', async () => {
    const { mcp, workspace } = await open();
    const listed = await mcp.call('list_workspaces', { pageSize: 100 });
    const names = [...listed.text.matchAll(/"name":\s*"([^"]+)"/g)].map((m) => m[1]);
    const others = [...new Set([...names.filter((n) => n !== workspace), 'not-rerun-fixtures'])];
    for (const name of others) {
      await expect(mcp.getWorkspaceDetails({ workspace: name })).rejects.toBeInstanceOf(WorkspaceScopeError);
    }
    await mcp.close();
  });
});
