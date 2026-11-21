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
} from '@modelcontextprotocol/sdk/types.js';
import { ALLOWED_TOOLS, isAllowedTool } from '../allowlist';

// W0-A stub: serves recorded fixtures for the SPEC §5 tool names with permissive schemas.
// W1-A replaces the internals (real schemas from fixtures/mcp/tools-list.json); keep the exports.

export const DEFAULT_SCENARIO = 'apply-time-exit-1';
export const FIXTURES_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');

export interface MockServerOptions {
  port?: number;
  host?: string;
  scenario?: string;
  fixturesDir?: string;
}

export interface MockServerHandle {
  url: string;
  close(): Promise<void>;
}

/** Fixture file shape: `{ "placeholder"?: true, "result": <tool output> }`; strings are returned verbatim. */
export function readFixture(fixturesDir: string, scenario: string, tool: string): CallToolResult {
  const file = path.join(fixturesDir, scenario, 'mcp', `${tool}.json`);
  if (!existsSync(file)) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'no_fixture',
            scenario,
            tool,
            path: path.relative(process.cwd(), file),
          }),
        },
      ],
    };
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { result?: unknown };
  const result = parsed.result ?? parsed;
  return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
}

function createMcpServer(scenario: string, fixturesDir: string): Server {
  const server = new Server(
    { name: 'rerun-mock-terraform-mcp', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: ALLOWED_TOOLS.map((name) => ({
      name,
      description: `Mock of terraform-mcp-server tool ${name} (scenario fixtures).`,
      inputSchema: { type: 'object' as const, additionalProperties: true },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, (request): CallToolResult => {
    const tool = request.params.name;
    if (!isAllowedTool(tool)) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Tool ${tool} is not in the Rerun allowlist` }],
      };
    }
    return readFixture(fixturesDir, scenario, tool);
  });
  return server;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<Omit<MockServerOptions, 'port' | 'host'>>,
) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/mcp') {
    res.writeHead(404).end();
    return;
  }
  const scenario = url.searchParams.get('scenario') ?? opts.scenario;
  const server = createMcpServer(scenario, opts.fixturesDir);
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

/** Starts a stateless streamable-HTTP MCP server at `/mcp`; `?scenario=` overrides the scenario per request. */
export async function startMockServer(options: MockServerOptions = {}): Promise<MockServerHandle> {
  const opts = {
    scenario: options.scenario ?? process.env.MOCK_SCENARIO ?? DEFAULT_SCENARIO,
    fixturesDir: options.fixturesDir ?? FIXTURES_DIR,
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
    http.listen(options.port ?? 8080, host, resolve);
  });
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/mcp`,
    close: () => new Promise<void>((resolve, reject) => http.close((err) => (err ? reject(err) : resolve()))),
  };
}
