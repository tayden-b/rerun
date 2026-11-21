import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { isAllowedTool } from '../allowlist';
import { SCENARIOS_DIR, TOOLS_LIST_PATH, fixtureCandidates, type ToolFixture } from '../fixtures';

// Mock Terraform MCP server (SPEC §1 demo mode): a real streamable-HTTP MCP server with the tool names and
// input schemas recorded from terraform-mcp-server 1.4 (`fixtures/mcp/tools-list.json`). Each call returns
// `fixtures/scenarios/<scenario>/mcp/<tool>.<argHash>.json` if present, else `<tool>.json` (see
// `argHash` in `../fixtures.ts`). The scenario comes from `?scenario=`, then the server option, then
// `MOCK_SCENARIO`, then `DEFAULT_SCENARIO`.

export const DEFAULT_SCENARIO = 'apply-time-exit-1';
export const FIXTURES_DIR = SCENARIOS_DIR;

export interface MockServerOptions {
  port?: number;
  host?: string;
  scenario?: string;
  fixturesDir?: string;
  toolsListPath?: string;
}

export interface MockServerHandle {
  url: string;
  close(): Promise<void>;
}

function errorResult(payload: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

export function loadToolsList(file: string = TOOLS_LIST_PATH): Tool[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { tools: Tool[] };
  return parsed.tools.filter((t) => isAllowedTool(t.name));
}

/** Fixture file shape: `ToolFixture`; string results are returned verbatim, anything else as JSON text. */
export function readFixture(
  fixturesDir: string,
  scenario: string,
  tool: string,
  args: Record<string, unknown> = {},
): CallToolResult {
  const dir = path.join(fixturesDir, scenario, 'mcp');
  const tried = fixtureCandidates(tool, args).map((name) => path.join(dir, name));
  const file = tried.find((f) => existsSync(f));
  if (!file) {
    return errorResult({
      error: 'no_fixture',
      scenario,
      tool,
      path: path.relative(process.cwd(), tried[tried.length - 1]),
      tried: tried.map((f) => path.relative(process.cwd(), f)),
    });
  }
  const fixture = JSON.parse(readFileSync(file, 'utf8')) as ToolFixture;
  const result = fixture.result;
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return { ...(fixture.isError ? { isError: true } : {}), content: [{ type: 'text', text }] };
}

function createMcpServer(scenario: string, fixturesDir: string, tools: Tool[]): Server {
  const server = new Server(
    { name: 'rerun-mock-terraform-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  const byName = new Map(tools.map((t) => [t.name, t]));
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, (request): CallToolResult => {
    const name = request.params.name;
    const def = byName.get(name);
    if (!def) {
      return errorResult({
        error: 'tool_not_allowed',
        tool: name,
        message: `Tool ${name} is not in the Rerun allowlist`,
      });
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const missing = (def.inputSchema.required ?? []).filter((k) => args[k] === undefined);
    if (missing.length > 0) return errorResult({ error: 'missing_arguments', tool: name, missing });
    return readFixture(fixturesDir, scenario, name, args);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { scenario: string; fixturesDir: string; tools: Tool[] },
) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  const scenario = url.searchParams.get('scenario') ?? opts.scenario;
  const server = createMcpServer(scenario, opts.fixturesDir, opts.tools);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

/** Starts a stateless streamable-HTTP MCP server at `/mcp`; `port: 0` picks a free port. */
export async function startMockServer(options: MockServerOptions = {}): Promise<MockServerHandle> {
  const opts = {
    scenario: options.scenario ?? process.env.MOCK_SCENARIO ?? DEFAULT_SCENARIO,
    fixturesDir: options.fixturesDir ?? FIXTURES_DIR,
    tools: loadToolsList(options.toolsListPath),
  };
  const http = createServer((req, res) => {
    handle(req, res, opts).catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    });
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 8081, host, resolve);
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.closeAllConnections();
        http.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
