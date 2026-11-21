import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Live tests hit real APIs with the keys from the environment. Never run in CI.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['src/**/*.live.test.ts', 'test/**/*.live.test.ts'],
    environment: 'node',
    env: { RERUN_MODE: 'live' },
    testTimeout: 600_000,
    passWithNoTests: true,
  },
});
