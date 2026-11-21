import { spawn, type ChildProcess } from 'node:child_process';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO_ENV } from '../../playwright.config';
import { runIdForScenario } from '../../src/incident/demo';

// Starts `npm run demo --fresh` (its own port, DB, workflow data and dist dir) rather than a config
// webServer, so it never runs alongside the dashboard project's `next build`/`next start`.
let demo: ChildProcess | undefined;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  demo = spawn('npx', ['tsx', 'scripts/demo.ts', '--fresh'], {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, ...DEMO_ENV },
  });
  await expect
    .poll(
      async () => (await fetch(`http://localhost:${DEMO_ENV.PORT}/api/incidents`).catch(() => null))?.status,
      {
        timeout: 280_000,
      },
    )
    .toBe(200);
});

test.afterAll(() => {
  if (demo?.pid) process.kill(-demo.pid, 'SIGTERM');
});

const RUN_ID = runIdForScenario('apply-time-exit-1');

interface Row {
  id: string;
  runId: string;
  status: string;
}

async function incident(request: APIRequestContext): Promise<Row | undefined> {
  const { incidents } = (await (await request.get('/api/incidents')).json()) as { incidents: Row[] };
  return incidents.find((i) => i.runId === RUN_ID);
}

test('npm run demo: a real workflow run reaches approval, then resolves after Approve', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await expect
    .poll(async () => (await incident(request))?.status, { timeout: 180_000 })
    .toBe('awaiting_approval');
  const { id } = (await incident(request))!;

  await page.goto(`/incidents/${id}`);
  const trace = page.getByTestId('investigation');
  for (const label of ['Opened pull request', 'Verified fix', 'Awaiting approval']) {
    await expect(trace).toContainText(label);
  }
  await expect(page.getByTestId('triage-card').getByTestId('probability-bar')).toHaveCount(4);
  const panels = page.getByTestId('subagent-panel');
  await expect(panels).toHaveCount(2);
  await expect(panels.first().getByTestId('tool-call').first()).toBeVisible();
  await expect(page.getByTestId('diff-block')).toHaveCount(1);
  await expect(page.getByTestId('diff-removed')).toContainText('exit 1');
  await expect(page.getByTestId('terminal-output')).not.toBeEmpty();
  await expect(page.getByTestId('pr-ref')).toHaveText(/^#\d+ · demo$/);
  await expect(page.locator('a[href*="/pull/"]')).toHaveCount(0);
  const approve = page.getByTestId('approve');
  await expect(approve).toBeEnabled();

  const response = page.waitForResponse((r) => r.url().endsWith(`/api/incidents/${id}/approve`));
  await approve.click();
  expect((await response).status()).toBe(200);
  await expect.poll(async () => (await incident(request))?.status, { timeout: 60_000 }).toBe('resolved');
  await page.reload();
  await expect(page.locator('[data-slot=status-pill]').first()).toHaveAttribute('data-status', 'resolved');
});
