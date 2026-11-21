import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { argHash, TOOLS_LIST_PATH } from '../../src/mcp/fixtures';
import { startMockServer, type MockServerHandle } from '../../src/mcp/mock/server';

let dir: string;
let server: MockServerHandle;

async function client(url: string): Promise<Client> {
  const c = new Client({ name: 'mock-test', version: '0.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}
function text(res: Awaited<ReturnType<Client['callTool']>>): string {
  return (res.content as { text: string }[])[0].text;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'rerun-mock-'));
  mkdirSync(path.join(dir, 'variants', 'mcp'), { recursive: true });
  const write = (name: string, result: unknown) =>
    writeFileSync(path.join(dir, 'variants', 'mcp', name), JSON.stringify({ result }));
  write('get_plan_logs.json', 'default plan log');
  write(`get_plan_logs.${argHash({ plan_id: 'plan-B' })}.json`, 'plan B log');
  server = await startMockServer({ port: 0, fixturesDir: dir, scenario: 'variants' });
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('mock Terraform MCP server', () => {
  it('serves the recorded tool names and schemas', async () => {
    const c = await client(server.url);
    const { tools } = await c.listTools();
    const recorded = (
      JSON.parse(readFileSync(TOOLS_LIST_PATH, 'utf8')) as { tools: { name: string; inputSchema: unknown }[] }
    ).tools;
    expect(tools.map((t) => [t.name, t.inputSchema])).toEqual(recorded.map((t) => [t.name, t.inputSchema]));
    await c.close();
  });

  it('picks the argument-hash variant, else the default fixture', async () => {
    const c = await client(server.url);
    expect(text(await c.callTool({ name: 'get_plan_logs', arguments: { plan_id: 'plan-B' } }))).toBe(
      'plan B log',
    );
    expect(text(await c.callTool({ name: 'get_plan_logs', arguments: { plan_id: 'plan-A' } }))).toBe(
      'default plan log',
    );
    await c.close();
  });

  it('reports the fixture path it looked for', async () => {
    const c = await client(server.url);
    const res = await c.callTool({ name: 'whoami', arguments: {} });
    expect(res.isError).toBe(true);
    const body = JSON.parse(text(res)) as { path: string; tried: string[] };
    expect(body.path).toContain(path.join('variants', 'mcp', 'whoami.json'));
    expect(body.tried).toHaveLength(2);
    await c.close();
  });

  it('rejects calls missing required arguments', async () => {
    const c = await client(server.url);
    const res = await c.callTool({ name: 'get_plan_logs', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.parse(text(res))).toMatchObject({ error: 'missing_arguments', missing: ['plan_id'] });
    await c.close();
  });
});

describe('argHash', () => {
  it('ignores key order and scope arguments', () => {
    expect(argHash({ a: 1, b: { y: 2, x: 1 } })).toBe(argHash({ b: { x: 1, y: 2 }, a: 1 }));
    expect(argHash({ pageSize: 20, workspace_name: 'w', terraform_org_name: 'o' })).toBe(
      argHash({ pageSize: 20 }),
    );
    expect(argHash({ plan_id: 'a' })).toMatch(/^[0-9a-f]{10}$/);
  });
});
