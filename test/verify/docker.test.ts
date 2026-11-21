import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockerVerifier, TERRAFORM_IMAGE } from '../../src/verify/docker';

const BIN = path.join(import.meta.dirname, 'bin');
const PLAN_OUT = [
  'Running plan in HCP Terraform. Output will stream here.',
  '',
  'Terraform will perform the following actions:',
  '',
  'Plan: 1 to add, 2 to change, 0 to destroy.',
].join('\n');

let dir: string;
let log: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'rerun-verify-'));
  log = path.join(dir, 'docker.log');
  writeFileSync(path.join(dir, 'main.tf'), 'terraform {}\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function verifier(env: Record<string, string>, timeoutMs?: number) {
  return new DockerVerifier({
    timeoutMs,
    env: { PATH: `${BIN}:${process.env.PATH}`, FAKE_DOCKER_LOG: log, ...env },
  });
}

const calls = () => readFileSync(log, 'utf8').trim().split('\n');

describe('DockerVerifier', () => {
  it('passes when fmt, init+validate and plan all succeed, and summarises the plan line', async () => {
    const res = await verifier({ FAKE_PLAN_STDOUT: PLAN_OUT, TFE_TOKEN: 'not-a-real-token' }).verify(dir);
    expect(res.ok).toBe(true);
    expect([res.fmt.ok, res.validate.ok, res.plan.ok]).toEqual([true, true, true]);
    expect(res.summary).toBe('Plan: 1 to add, 2 to change, 0 to destroy.');
    const subs = calls().map((c) => c.split(' ')[1]);
    expect(subs).toEqual(['fmt', 'init', 'validate', 'plan']);
    for (const call of calls()) {
      expect(call).toContain('token=set');
      expect(call).toContain(`${dir}:/work`);
      expect(call).toContain(TERRAFORM_IMAGE);
      expect(call).toContain('TF_IN_AUTOMATION=1');
      expect(call).toContain('TF_INPUT=0');
      expect(call).not.toContain('not-a-real-token');
    }
    expect(calls()[3]).toContain('plan -input=false -no-color');
  });

  it('reports "No changes." as an all-zero plan line', async () => {
    const res = await verifier({
      FAKE_PLAN_STDOUT: 'No changes. Your infrastructure matches the configuration.',
    }).verify(dir);
    expect(res.summary).toBe('Plan: 0 to add, 0 to change, 0 to destroy (no changes).');
  });

  it('stops at fmt and names the unformatted files', async () => {
    const res = await verifier({ FAKE_FMT_EXIT: '3', FAKE_FMT_STDOUT: 'main.tf' }).verify(dir);
    expect(res.ok).toBe(false);
    expect(res.fmt).toMatchObject({ ok: false, exitCode: 3 });
    expect(res.validate.ok).toBe(false);
    expect(res.plan.exitCode).toBe(-1);
    expect(res.summary).toBe('terraform fmt -check failed: main.tf not formatted.');
    expect(calls()).toHaveLength(1);
  });

  it('stops at init and reports the first error line', async () => {
    const res = await verifier({
      FAKE_INIT_EXIT: '1',
      FAKE_INIT_STDERR:
        '╷\n│ Error: Failed to query available provider packages\n│\n│ Could not retrieve the list',
    }).verify(dir);
    expect(res.ok).toBe(false);
    expect(res.fmt.ok).toBe(true);
    expect(res.validate).toMatchObject({ ok: false, exitCode: 1 });
    expect(res.summary).toBe('Error: Failed to query available provider packages');
    expect(calls().map((c) => c.split(' ')[1])).toEqual(['fmt', 'init']);
  });

  it('combines init and validate output and stops before plan when validate fails', async () => {
    const res = await verifier({
      FAKE_INIT_STDOUT: 'Terraform has been successfully initialized!',
      FAKE_VALIDATE_EXIT: '1',
      FAKE_VALIDATE_STDERR: 'Error: Reference to undeclared resource',
    }).verify(dir);
    expect(res.validate.stdout).toContain('successfully initialized');
    expect(res.validate.stderr).toContain('undeclared resource');
    expect(res.summary).toBe('Error: Reference to undeclared resource');
    expect(calls()).toHaveLength(3);
  });

  it('fails on a plan error', async () => {
    const res = await verifier({
      FAKE_PLAN_EXIT: '1',
      FAKE_PLAN_STDERR: 'Error: Resource precondition failed',
    }).verify(dir);
    expect(res.ok).toBe(false);
    expect([res.fmt.ok, res.validate.ok, res.plan.ok]).toEqual([true, true, false]);
    expect(res.summary).toBe('Error: Resource precondition failed');
  });

  it('redacts tokens in step output', async () => {
    const token = `ghp_${'a'.repeat(36)}`;
    const res = await verifier({ FAKE_PLAN_STDOUT: `${PLAN_OUT}\nleaked ${token}` }).verify(dir);
    expect(res.plan.stdout).not.toContain(token);
    expect(res.plan.stdout).toContain('[REDACTED:github_token]');
  });

  it('kills the container and fails when the budget runs out', async () => {
    const started = Date.now();
    const res = await verifier({ FAKE_PLAN_SLEEP: '30' }, 1500).verify(dir);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(res.ok).toBe(false);
    expect(res.plan).toMatchObject({ ok: false, exitCode: 124 });
    expect(res.summary).toBe('terraform plan timed out; the container was killed.');
    await new Promise((r) => setTimeout(r, 300));
    const kill = calls().find((c) => c.startsWith('kill '));
    expect(kill).toMatch(/^kill rerun-verify-[0-9a-f]{12}$/);
  });

  it('rejects a workdir that does not exist', async () => {
    await expect(verifier({}).verify(path.join(dir, 'missing'))).rejects.toThrow();
  });
});
