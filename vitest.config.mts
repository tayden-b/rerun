import path from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
    environment: 'node',
    env: { RERUN_MODE: 'demo' },
    testTimeout: 15_000,
  },
});
