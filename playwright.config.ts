import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
export const E2E_ENV = { RERUN_MODE: 'demo', DATABASE_URL: 'file:data/e2e.db' };

export default defineConfig({
  testDir: 'test/ui/e2e',
  outputDir: 'test-results',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalSetup: './test/ui/e2e/global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${PORT}`, colorScheme: 'dark', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: E2E_ENV,
  },
});
