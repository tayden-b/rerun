import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../shared/redact';
import type { StepOutput, Verifier, VerifyResult } from '../shared/types';

/** Exact tag: `hashicorp/terraform:1.14` resolved to 1.14.9 when this was pinned. */
export const TERRAFORM_IMAGE = 'hashicorp/terraform:1.14.9';
export const DEFAULT_VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const TIMEOUT_EXIT_CODE = 124;
const TOKEN_VAR = 'TF_TOKEN_app_terraform_io';

export interface DockerVerifierOptions {
  image?: string;
  /** Docker executable; resolved on `env.PATH` (default `docker`). */
  dockerBin?: string;
  /** Total budget for all three steps; the running container is killed when it runs out. */
  timeoutMs?: number;
  /** Environment for the docker CLI. The HCP Terraform token is read from `TF_TOKEN_app_terraform_io` or `TFE_TOKEN`. */
  env?: Record<string, string | undefined>;
}

interface Exec {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Runs `terraform fmt -check`, `init` + `validate`, and a speculative remote `plan` (via the config's
 * `cloud {}` block) in a throwaway container with `workdir` mounted at `/work`. Stops at the first failure.
 */
export class DockerVerifier implements Verifier {
  readonly name = 'docker' as const;
  private readonly image: string;
  private readonly dockerBin: string;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: DockerVerifierOptions = {}) {
    this.image = opts.image ?? TERRAFORM_IMAGE;
    this.dockerBin = opts.dockerBin ?? 'docker';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    this.env = opts.env ?? process.env;
  }

  async verify(workdir: string): Promise<VerifyResult> {
    const dir = path.resolve(workdir);
    if (!(await stat(dir)).isDirectory()) throw new Error(`Verifier workdir is not a directory: ${dir}`);
    const deadline = Date.now() + this.timeoutMs;
    const skipped = skippedStep();

    const fmt = toStep(await this.terraform(dir, ['fmt', '-check', '-recursive', '-no-color'], deadline));
    if (!fmt.ok) return result({ fmt, validate: skipped, plan: skipped }, failureSummary('fmt', fmt));

    const init = await this.terraform(dir, ['init', '-input=false', '-no-color'], deadline);
    const validate =
      init.exitCode === 0
        ? combine(init, await this.terraform(dir, ['validate', '-no-color'], deadline))
        : toStep(init);
    if (!validate.ok) return result({ fmt, validate, plan: skipped }, failureSummary('validate', validate));

    const plan = toStep(await this.terraform(dir, ['plan', '-input=false', '-no-color'], deadline));
    if (!plan.ok) return result({ fmt, validate, plan }, failureSummary('plan', plan));
    return result({ fmt, validate, plan }, planSummary(plan.stdout));
  }

  private terraform(dir: string, args: string[], deadline: number): Promise<Exec> {
    const container = `rerun-verify-${randomBytes(6).toString('hex')}`;
    const user =
      typeof process.getuid === 'function' && typeof process.getgid === 'function'
        ? ['--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp']
        : [];
    const dockerArgs = [
      'run',
      '--rm',
      '--name',
      container,
      '-v',
      `${dir}:/work`,
      '-w',
      '/work',
      ...user,
      // Passed by name so the token value never appears in the process list.
      '-e',
      TOKEN_VAR,
      '-e',
      'TF_IN_AUTOMATION=1',
      '-e',
      'TF_INPUT=0',
      this.image,
      ...args,
    ];
    const token = this.env[TOKEN_VAR] ?? this.env.TFE_TOKEN;
    const env = { ...this.env, ...(token ? { [TOKEN_VAR]: token } : {}) };
    return run(this.dockerBin, dockerArgs, env, deadline - Date.now(), () =>
      killContainer(this.dockerBin, container, env),
    );
  }
}

function run(
  bin: string,
  args: string[],
  env: Record<string, string | undefined>,
  budgetMs: number,
  onTimeout: () => void,
) {
  const started = Date.now();
  return new Promise<Exec>((resolve) => {
    if (budgetMs <= 0) {
      resolve({
        exitCode: TIMEOUT_EXIT_CODE,
        stdout: '',
        stderr: timeoutMessage(),
        durationMs: 0,
        timedOut: true,
      });
      return;
    }
    const child = spawn(bin, args, { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (exec: Omit<Exec, 'durationMs'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...exec, durationMs: Date.now() - started });
    };
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (err) =>
      finish({ exitCode: 127, stdout, stderr: `${stderr}${err.message}\n`, timedOut: false }),
    );
    child.on('close', (code) => finish({ exitCode: code ?? 1, stdout, stderr, timedOut: false }));
    const timer = setTimeout(() => {
      onTimeout();
      child.kill('SIGKILL');
      finish({ exitCode: TIMEOUT_EXIT_CODE, stdout, stderr: `${stderr}${timeoutMessage()}`, timedOut: true });
    }, budgetMs);
  });
}

function killContainer(bin: string, container: string, env: Record<string, string | undefined>): void {
  const killer = spawn(bin, ['kill', container], { env: env as NodeJS.ProcessEnv, stdio: 'ignore' });
  killer.on('error', () => undefined);
}

function timeoutMessage(): string {
  return 'Verification timed out; the container was killed.\n';
}

function toStep(exec: Exec): StepOutput {
  return {
    ok: exec.exitCode === 0 && !exec.timedOut,
    exitCode: exec.exitCode,
    stdout: redact(exec.stdout),
    stderr: redact(exec.stderr),
    durationMs: exec.durationMs,
  };
}

function combine(first: Exec, second: Exec): StepOutput {
  return toStep({
    exitCode: second.exitCode,
    stdout: first.stdout + second.stdout,
    stderr: first.stderr + second.stderr,
    durationMs: first.durationMs + second.durationMs,
    timedOut: second.timedOut,
  });
}

function skippedStep(): StepOutput {
  return { ok: false, exitCode: -1, stdout: '', stderr: 'skipped: an earlier step failed', durationMs: 0 };
}

function result(steps: Pick<VerifyResult, 'fmt' | 'validate' | 'plan'>, summary: string): VerifyResult {
  return { ok: steps.fmt.ok && steps.validate.ok && steps.plan.ok, ...steps, summary };
}

/** The plan's `Plan: X to add, Y to change, Z to destroy` line; "No changes." is reported as all zeros. */
export function planSummary(stdout: string): string {
  const line = stdout.match(/^\s*Plan: \d+ to add, \d+ to change, \d+ to destroy\.?.*$/m);
  if (line) return line[0].trim();
  if (/^\s*No changes\./m.test(stdout)) return 'Plan: 0 to add, 0 to change, 0 to destroy (no changes).';
  return 'Plan succeeded.';
}

/** The first `Error:` line of a failed step (fmt: the files that need formatting). */
export function failureSummary(step: 'fmt' | 'validate' | 'plan', out: StepOutput): string {
  if (out.exitCode === TIMEOUT_EXIT_CODE && out.stderr.includes('timed out')) {
    return `terraform ${step} timed out; the container was killed.`;
  }
  const lines = `${out.stderr}\n${out.stdout}`.split('\n').map((l) => l.replace(/^[\s│╷╵]+/, '').trimEnd());
  const error = lines.find((l) => l.startsWith('Error:'));
  if (error) return error;
  if (step === 'fmt') {
    const files = out.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (files.length > 0) return `terraform fmt -check failed: ${files.join(', ')} not formatted.`;
  }
  const first = lines.find((l) => l.length > 0);
  return first
    ? `terraform ${step} failed: ${first}`
    : `terraform ${step} failed with exit code ${out.exitCode}.`;
}
