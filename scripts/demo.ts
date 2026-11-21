import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';

// `npm run demo [-- --fresh]`: RERUN_MODE=demo, the mock Terraform MCP server in-process, `next dev`, and a
// real incident workflow for the recorded `apply-time-exit-1` run, kicked off through the signed HCP
// Terraform webhook once the server is up (when the run has no incident yet, or with --fresh).
process.env.RERUN_MODE = 'demo';
process.env.RERUN_DEMO_PACE ??= '1';
const SCENARIO = process.env.RERUN_DEMO_SCENARIO ?? 'apply-time-exit-1';

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      if (Date.now() > deadline) throw new Error(`demo: ${url} did not come up`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  await import('./load-env');
  const fresh = process.argv.includes('--fresh');
  if (fresh) {
    const dbFile = (process.env.DATABASE_URL ?? 'file:data/rerun.db').replace(/^file:/, '');
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${dbFile}${suffix}`, { force: true });
    rmSync(process.env.WORKFLOW_LOCAL_DATA_DIR ?? '.workflow-data', { recursive: true, force: true });
  }
  const secret = (process.env.TFC_WEBHOOK_SECRET ??= randomBytes(32).toString('hex'));

  const { startMockServer } = await import('../src/mcp/mock/server');
  const mock = await startMockServer({ port: Number(process.env.MOCK_MCP_PORT ?? 8080) });
  process.env.TERRAFORM_MCP_URL = mock.url;

  const { config } = await import('../src/config');
  const { getDb } = await import('../src/db');
  const { listIncidents } = await import('../src/db/incidents');
  const { runIdForScenario } = await import('../src/incident/demo');
  const { signBody, SIGNATURE_HEADER } = await import('../src/incident/webhook');
  const runId = runIdForScenario(SCENARIO);
  const kick = !(await listIncidents(await getDb())).some((incident) => incident.runId === runId);

  const port = process.env.PORT ?? '3000';
  const base = `http://127.0.0.1:${port}`;
  console.log(`demo: mock MCP ${mock.url}, database ${config.databaseUrl}, app http://localhost:${port}`);
  const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', port], {
    stdio: 'inherit',
    env: process.env,
  });
  const shutdown = (signal: NodeJS.Signals) => next.kill(signal);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  next.on('exit', (code) => {
    void mock.close().finally(() => process.exit(code ?? 0));
  });

  if (!kick) return;
  await waitFor(base, 180_000);
  const body = JSON.stringify({
    payload_version: 1,
    run_id: runId,
    run_message: `scenario: ${SCENARIO}`,
    workspace_name: config.workspace,
    organization_name: config.tfeOrg ?? 'demo',
    notifications: [{ trigger: 'run:errored', run_status: 'errored', message: 'Run Errored' }],
  });
  const res = await fetch(`${base}/api/webhook/tfc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: signBody(body, secret),
    },
    body,
  });
  console.log(`demo: started the ${SCENARIO} incident (${res.status}) ${await res.text()}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
