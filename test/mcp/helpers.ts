import { startMockServer, type MockServerHandle } from '../../src/mcp/mock/server';
import { createTerraformMcp, type TerraformMcp } from '../../src/mcp/terraform';

export const ORG = 'hashi-org-TF';
export const WORKSPACE = 'rerun-fixtures';

export async function startMock(): Promise<MockServerHandle> {
  return startMockServer({ port: 0 });
}

export function connect(server: MockServerHandle, scenario: string): Promise<TerraformMcp> {
  return createTerraformMcp({ url: `${server.url}?scenario=${scenario}`, org: ORG, workspace: WORKSPACE });
}
