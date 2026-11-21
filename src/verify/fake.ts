import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { StepOutput, Verifier, VerifyResult } from '../shared/types';

export interface FakeVerifierOptions {
  /** Scenario name; `<fixturesDir>/<scenario>/verify.json` is returned when it exists. */
  scenario?: string;
  fixturesDir?: string;
  /** Wait out the simulated stage timings so the replay takes as long as it reports (`npm run demo`). */
  pace?: boolean;
}

const pass = (stdout: string, durationMs: number): StepOutput => ({
  ok: true,
  exitCode: 0,
  stdout,
  stderr: '',
  durationMs,
});

export const GENERIC_PASS: VerifyResult = {
  ok: true,
  // Simulated stage timings, typical of the Docker verifier against HCP Terraform.
  fmt: pass('', 380),
  validate: pass('Success! The configuration is valid.\n', 1_450),
  plan: pass('Plan: 0 to add, 1 to change, 0 to destroy.\n', 4_200),
  summary: 'Plan: 0 to add, 1 to change, 0 to destroy.',
};

/** Demo-mode verifier: replays a recorded `VerifyResult` without Docker or HCP Terraform. */
export class FakeVerifier implements Verifier {
  readonly name = 'fake' as const;
  private readonly scenario?: string;
  private readonly fixturesDir: string;
  private readonly pace: boolean;

  constructor(opts: FakeVerifierOptions = {}) {
    this.scenario = opts.scenario;
    this.fixturesDir = opts.fixturesDir ?? path.join(process.cwd(), 'fixtures', 'scenarios');
    this.pace = opts.pace ?? false;
  }

  async verify(workdir: string): Promise<VerifyResult> {
    void workdir;
    const result = this.recorded() ?? structuredClone(GENERIC_PASS);
    if (this.pace) {
      const ms = result.fmt.durationMs + result.validate.durationMs + result.plan.durationMs;
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return result;
  }

  private recorded(): VerifyResult | undefined {
    if (!this.scenario) return undefined;
    const file = path.join(this.fixturesDir, this.scenario, 'verify.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as VerifyResult) : undefined;
  }
}
