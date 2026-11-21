import { expect, test, type APIRequestContext } from '@playwright/test';
import { runIdForScenario } from '../../src/incident/demo';

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
  const approve = page.getByTestId('approve');
  await expect(approve).toBeEnabled();

  const response = page.waitForResponse((r) => r.url().endsWith(`/api/incidents/${id}/approve`));
  await approve.click();
  expect((await response).status()).toBe(200);
  await expect.poll(async () => (await incident(request))?.status, { timeout: 60_000 }).toBe('resolved');
  await page.reload();
  await expect(page.locator('[data-slot=status-pill]').first()).toHaveAttribute('data-status', 'resolved');
});
