import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Boots `npm run demo` (mock MCP + seeded DB + `next dev`) and drives the Workflow SDK ping through the Local World.

const root = path.resolve(__dirname, '..', '..');
const tmp = mkdtempSync(path.join(tmpdir(), 'rerun-demo-'));
let child: ChildProcess;
let baseUrl: string;
let output = '';
let exited: number | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (exited !== null)
      throw new Error(`npm run demo exited with ${exited} while waiting for ${what}:\n${output}`);
    try {
      const value = await fn();
      if (value !== undefined) return value;
    } catch {
      // server not ready yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Server output:\n${output}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

beforeAll(async () => {
  const [port, mockPort] = await Promise.all([freePort(), freePort()]);
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(path.join(root, 'node_modules', '.bin', 'tsx'), ['scripts/demo.ts'], {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      MOCK_MCP_PORT: String(mockPort),
      NEXT_DIST_DIR: '.next-test',
      DATABASE_URL: `file:${path.join(tmp, 'rerun.db')}`,
      WORKFLOW_LOCAL_DATA_DIR: path.join(tmp, 'workflow-data'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d: Buffer) => (output += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (output += d.toString()));
  child.on('exit', (code) => (exited = code ?? -1));
  await waitFor(
    async () => {
      return (await fetch(`${baseUrl}/api/ping`)).status === 400 ? true : undefined;
    },
    150_000,
    'the demo dev server',
  );
}, 180_000);

afterAll(() => {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already exited
    }
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe('npm run demo', () => {
  it('serves / listing the seeded placeholder incident', async () => {
    const html = await waitFor(
      async () => {
        const body = await (await fetch(baseUrl)).text();
        return body.includes('run-PLACEHOLDER0001') ? body : undefined;
      },
      60_000,
      'the seeded incident on /',
    );
    expect(html).toContain('apply_runtime');
  }, 90_000);

  it('runs the ping workflow step to completion in the Local World', async () => {
    const started = await fetch(`${baseUrl}/api/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(started.status).toBe(202);
    const { runId } = (await started.json()) as { runId: string };

    const done = await waitFor(
      async () => {
        const res = (await (await fetch(`${baseUrl}/api/ping?runId=${runId}`)).json()) as {
          status: string;
          result: { pong: string } | null;
        };
        if (res.status === 'failed') throw new Error(`workflow failed: ${JSON.stringify(res)}`);
        return res.status === 'completed' ? res : undefined;
      },
      60_000,
      'the ping workflow',
    );
    expect(done.result?.pong).toBe('hello');
  }, 90_000);
});
