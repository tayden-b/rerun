import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { E2E_ENV } from '../../../playwright.config';

export default function globalSetup(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`data/e2e.db${suffix}`, { force: true });
  execFileSync('npx', ['tsx', 'scripts/seed-demo.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ...E2E_ENV },
  });
}
