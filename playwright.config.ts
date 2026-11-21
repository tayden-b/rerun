import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const DEMO_PORT = 3200;
export const E2E_ENV = { RERUN_MODE: 'demo', DATABASE_URL: 'file:data/e2e.db' };
/** `npm run demo --fresh` on its own port, database, workflow data and dist dir: a real workflow run. */
export const DEMO_ENV = {
  PORT: String(DEMO_PORT),
  MOCK_MCP_PORT: '8190',
  DATABASE_URL: 'file:data/e2e-demo.db',
  WORKFLOW_LOCAL_DATA_DIR: 'data/workflow-e2e',
  NEXT_DIST_DIR: '.next-e2e-demo',
};

export default defineConfig({
  outputDir: 'test-results',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './test/ui/e2e/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, colorScheme: 'dark', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      testDir: 'test/ui/e2e',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'demo',
      testDir: 'test/e2e',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        // `next dev` only serves dev assets to localhost (allowedDevOrigins), so the demo project uses localhost.
        baseURL: `http://localhost:${DEMO_PORT}`,
      },
    },
  ],
  webServer: [
    {
      command: `npx next build && npx next start --port ${PORT}`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      env: E2E_ENV,
    },
    {
      // After the dashboard server is up: `next build` and `next dev` both generate app/.well-known/workflow.
      command: `until curl -sf -o /dev/null http://127.0.0.1:${PORT}; do sleep 2; done; npx tsx scripts/demo.ts --fresh`,
      url: `http://127.0.0.1:${DEMO_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 600_000,
      env: DEMO_ENV,
    },
  ],
});
