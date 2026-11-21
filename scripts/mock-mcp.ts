import { DEFAULT_SCENARIO, startMockServer } from '../src/mcp/mock/server';

async function main(): Promise<void> {
  const port = Number(process.env.MOCK_MCP_PORT ?? 8080);
  const server = await startMockServer({ port });
  console.log(
    `mock terraform MCP server listening on ${server.url} (scenario: ${process.env.MOCK_SCENARIO ?? DEFAULT_SCENARIO})`,
  );
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
