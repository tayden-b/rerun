import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DockerVerifier } from '../../src/verify/docker';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const live = Boolean(process.env.TFE_TOKEN) && dockerAvailable();
const repo = process.env.RERUN_FIXTURES_REPO ?? 'tayden-b/rerun-fixtures';

describe.runIf(live)('DockerVerifier (live: Docker + TFE_TOKEN)', () => {
  it(
    'passes on rerun-fixtures@main with a speculative remote plan',
    { timeout: 11 * 60 * 1000 },
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'rerun-live-verify-'));
      try {
        execFileSync('git', ['clone', '--quiet', '--depth', '1', `https://github.com/${repo}.git`, dir]);
        const res = await new DockerVerifier().verify(dir);
        console.log(`live verifier summary: ${res.summary}`);
        expect(res.ok).toBe(true);
        expect(res.summary).toContain('Plan:');
        expect(res.plan.stdout).toMatch(/Running plan in (HCP Terraform|Terraform Cloud)/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
