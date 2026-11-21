import { expect, test } from '@playwright/test';
import { ALLOWED_TOOLS } from '../../../src/mcp/allowlist';

const SCREENSHOTS = 'test/ui/__screenshots__';
const AWAITING = '/incidents/demo-awaiting-approval';

test('incident list shows the seeded incidents and filters them', async ({ page }) => {
  await page.goto('/');
  const rows = page.getByTestId('incident-row');
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('mode-badge')).toHaveText('demo');
  await expect(rows.first().locator('[data-slot=status-pill]')).toHaveAttribute(
    'data-status',
    'awaiting_approval',
  );
  await expect(rows.first().getByRole('link').first()).toBeVisible();
  // Fake GitHub PR numbers would collide with real PRs, so demo mode never links them.
  await expect(rows.first().getByTestId('pr-ref')).toHaveText(/^#\d+ · demo$/);
  await expect(page.locator('a[href*="/pull/"]')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SCREENSHOTS}/list.png` });

  await page.getByRole('combobox', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Resolved' }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Missing input');
});

test('war room renders the awaiting-approval investigation', async ({ page }) => {
  await page.goto('/');
  await page
    .getByTestId('incident-row')
    .filter({ hasText: 'Awaiting approval' })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`${AWAITING}$`));

  await expect(page.getByTestId('triage-card').getByTestId('probability-bar')).toHaveCount(4);
  await expect(page.getByTestId('stack-trace')).toContainText('local-exec provisioner error');
  await expect(page.getByTestId('subagent-panel')).toHaveCount(2);
  await expect(page.getByTestId('subagent-panel').first().getByTestId('tool-call').first()).toBeVisible();
  await expect(page.getByTestId('diff-block')).toHaveCount(1);
  await expect(page.getByTestId('diff-removed')).toContainText('exit 1');
  await expect(page.getByTestId('terminal-output')).toContainText(
    'Plan: 1 to add, 0 to change, 1 to destroy.',
  );
  await expect(page.getByTestId('approve')).toBeEnabled();

  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SCREENSHOTS}/war-room.png` });
});

test('approve posts an empty body and shows an error toast while the route is missing', async ({ page }) => {
  await page.goto(AWAITING);
  const approve = page.getByTestId('approve');
  const request = page.waitForRequest(
    (r) => r.url().endsWith(`/api${AWAITING}/approve`) && r.method() === 'POST',
  );
  await approve.click();
  expect((await request).postDataJSON()).toEqual({});
  await expect(page.getByText('Approval not recorded')).toBeVisible();
  await expect(approve).toBeEnabled();
});

test('request changes posts the comment', async ({ page }) => {
  await page.goto(AWAITING);
  await page.getByTestId('request-changes').click();
  await page.getByLabel('Request changes comment').fill('Keep the exit code but make it conditional.');
  const request = page.waitForRequest((r) => r.url().endsWith(`/api${AWAITING}/request-changes`));
  await page.getByRole('button', { name: 'Send request' }).click();
  expect((await request).postDataJSON()).toEqual({ comment: 'Keep the exit code but make it conditional.' });
  await expect(page.getByText('Request not recorded')).toBeVisible();
});

test('read-only API serves incidents', async ({ request }) => {
  const list = await request.get('/api/incidents');
  expect((await list.json()).incidents).toHaveLength(3);
  const detail = await request.get(`/api${AWAITING}`);
  expect((await detail.json()).incident.events.length).toBeGreaterThan(20);
  expect((await request.get('/api/incidents/nope')).status()).toBe(404);
});

test('SSE stream sends ready on connect', async ({ page }) => {
  await page.goto('/');
  const ready = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const source = new EventSource('/api/incidents/stream');
        source.addEventListener('ready', (event) => {
          source.close();
          resolve(JSON.parse((event as MessageEvent<string>).data));
        });
        setTimeout(() => reject(new Error('no ready event')), 5_000);
      }),
  );
  expect(ready).toEqual({ incidents: 3 });
});

test('about page lists every allowlisted MCP tool', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByTestId('architecture')).toContainText('Terraform MCP server');
  await expect(page.getByTestId('mcp-tool')).toHaveCount(ALLOWED_TOOLS.length);
  for (const tool of ALLOWED_TOOLS) await expect(page.getByTestId('mcp-tools')).toContainText(tool);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SCREENSHOTS}/about.png` });
});
