import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// `npm run demo`: RERUN_MODE=demo, mock Terraform MCP server in-process, placeholder incident seeded, `next dev`.
process.env.RERUN_MODE = 'demo';

async function main(): Promise<void> {
  await import('./load-env');
  const { startMockServer, FIXTURES_DIR, DEFAULT_SCENARIO } = await import('../src/mcp/mock/server');
  const mock = await startMockServer({ port: Number(process.env.MOCK_MCP_PORT ?? 8080) });
  process.env.TERRAFORM_MCP_URL = mock.url;

  const { config } = await import('../src/config');
  const { getDb } = await import('../src/db');
  const { appendEvent, createIncident, listIncidents, setStatus } = await import('../src/db/incidents');

  function fixture<T>(scenario: string, file: string): T {
    return JSON.parse(readFileSync(path.join(FIXTURES_DIR, scenario, file), 'utf8')) as T;
  }

  async function seedPlaceholderIncident(scenario: string): Promise<void> {
    const db = await getDb();
    const run = fixture<{ result: { id: string } }>(scenario, 'mcp/get_run_details.json').result;
    const expected = fixture<{ failureClass: never; stage: never; route: never }>(scenario, 'expected.json');
    if ((await listIncidents(db)).some((incident) => incident.runId === run.id)) return;

    const incident = await createIncident(db, { runId: run.id, workspace: config.workspace });
    await appendEvent(db, incident.id, {
      step: 'collect',
      kind: 'tool_call',
      title: 'get_run_details',
      payload: { runId: run.id },
    });
    await appendEvent(db, incident.id, {
      step: 'collect',
      kind: 'tool_result',
      title: 'get_run_details',
      payload: run,
    });
    await setStatus(db, incident.id, 'awaiting_approval', {
      failureClass: expected.failureClass,
      stage: expected.stage,
      route: expected.route,
    });
  }

  await seedPlaceholderIncident(DEFAULT_SCENARIO);

  const port = process.env.PORT ?? '3000';
  console.log(`demo: mock MCP ${mock.url}, database ${config.databaseUrl}, app http://localhost:${port}`);

  const next = spawn(path.join(process.cwd(), 'node_modules', '.bin', 'next'), ['dev', '--port', port], {
    stdio: 'inherit',
    env: process.env,
  });

  const shutdown = (signal: NodeJS.Signals) => {
    next.kill(signal);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  next.on('exit', (code) => {
    void mock.close().finally(() => process.exit(code ?? 0));
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
