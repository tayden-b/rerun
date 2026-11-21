import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StepOutput, Verifier, VerifyResult } from '../shared/types';

export interface FakeVerifierOptions {
  /** Scenario name; `<fixturesDir>/<scenario>/verify.json` is returned when it exists. */
  scenario?: string;
  fixturesDir?: string;
}

const pass = (stdout: string): StepOutput => ({ ok: true, exitCode: 0, stdout, stderr: '', durationMs: 0 });

export const GENERIC_PASS: VerifyResult = {
  ok: true,
  fmt: pass(''),
  validate: pass('Success! The configuration is valid.\n'),
  plan: pass('Plan: 0 to add, 1 to change, 0 to destroy.\n'),
  summary: 'Plan: 0 to add, 1 to change, 0 to destroy.',
};

/** Demo-mode verifier: replays a recorded `VerifyResult` without Docker or HCP Terraform. */
export class FakeVerifier implements Verifier {
  readonly name = 'fake' as const;
  private readonly scenario?: string;
  private readonly fixturesDir: string;

  constructor(opts: FakeVerifierOptions = {}) {
    this.scenario = opts.scenario;
    this.fixturesDir = opts.fixturesDir ?? path.join(process.cwd(), 'fixtures', 'scenarios');
  }

  async verify(workdir: string): Promise<VerifyResult> {
    void workdir;
    if (this.scenario) {
      const file = path.join(this.fixturesDir, this.scenario, 'verify.json');
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as VerifyResult;
    }
    return structuredClone(GENERIC_PASS);
  }
}
