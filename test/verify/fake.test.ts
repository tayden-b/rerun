import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { VerifyResult } from '../../src/shared/types';
import {
  createVerifier,
  DockerVerifier,
  FakeVerifier,
  GENERIC_PASS,
  NotImplementedError,
} from '../../src/verify';

const fixturesDir = mkdtempSync(path.join(tmpdir(), 'rerun-fake-verify-'));
afterAll(() => rmSync(fixturesDir, { recursive: true, force: true }));

describe('FakeVerifier', () => {
  it('returns the scenario verify.json when present', async () => {
    const recorded: VerifyResult = { ...GENERIC_PASS, summary: 'Plan: 3 to add, 0 to change, 0 to destroy.' };
    mkdirSync(path.join(fixturesDir, 'demo'));
    writeFileSync(path.join(fixturesDir, 'demo', 'verify.json'), JSON.stringify(recorded));
    const res = await new FakeVerifier({ scenario: 'demo', fixturesDir }).verify('/nowhere');
    expect(res).toEqual(recorded);
  });

  it('falls back to a generic pass', async () => {
    const res = await new FakeVerifier({ scenario: 'unknown', fixturesDir }).verify('/nowhere');
    expect(res.ok).toBe(true);
    expect(res.summary).toMatch(/^Plan: /);
  });
});

describe('createVerifier', () => {
  it('uses the fake in demo mode', () => {
    expect(createVerifier(loadConfig({ RERUN_MODE: 'demo' })).name).toBe('fake');
  });

  it('uses Docker in live mode and requires TFE_ORG', () => {
    expect(() => createVerifier(loadConfig({ RERUN_MODE: 'live' }))).toThrow(/TFE_ORG/);
    expect(createVerifier(loadConfig({ RERUN_MODE: 'live', TFE_ORG: 'org' }))).toBeInstanceOf(DockerVerifier);
  });

  it('exposes the Vercel Sandbox stub', async () => {
    const v = createVerifier(loadConfig({ RERUN_MODE: 'demo' }), { kind: 'vercel-sandbox' });
    await expect(v.verify('/nowhere')).rejects.toBeInstanceOf(NotImplementedError);
    await expect(v.verify('/nowhere')).rejects.toThrow(/Dec 2026 fair-use window/);
  });
});
