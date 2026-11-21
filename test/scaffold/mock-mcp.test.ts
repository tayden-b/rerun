import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_TOOLS } from '../../src/mcp/allowlist';
import { startMockServer, type MockServerHandle } from '../../src/mcp/mock/server';

let server: MockServerHandle;

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 'scaffold-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

beforeAll(async () => {
  server = await startMockServer({ port: 0 });
});
afterAll(() => server.close());

describe('mock Terraform MCP server (W0-A stub)', () => {
  it('lists exactly the SPEC §5 allowlist', async () => {
    const client = await connect(server.url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...ALLOWED_TOOLS].sort());
    await client.close();
  });

  it('serves the scenario fixture for a tool', async () => {
    const client = await connect(server.url);
    const res = await client.callTool({
      name: 'get_run_details',
      arguments: { run_id: 'run-PLACEHOLDER0001' },
    });
    const [content] = res.content as { type: string; text: string }[];
    expect(JSON.parse(content.text)).toMatchObject({
      id: 'run-PLACEHOLDER0001',
      attributes: { status: 'errored' },
    });
    await client.close();
  });

  it('returns a structured no-fixture error', async () => {
    const client = await connect(`${server.url}?scenario=does-not-exist`);
    const res = await client.callTool({ name: 'whoami', arguments: {} });
    expect(res.isError).toBe(true);
    const [content] = res.content as { type: string; text: string }[];
    expect(JSON.parse(content.text)).toMatchObject({
      error: 'no_fixture',
      scenario: 'does-not-exist',
      tool: 'whoami',
    });
    await client.close();
  });

  it('refuses tools outside the allowlist', async () => {
    const client = await connect(server.url);
    const res = await client.callTool({ name: 'create_run', arguments: {} });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
