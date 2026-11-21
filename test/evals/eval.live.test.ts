import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { main } from '../../evals/cli';
import { evalResultsSchema } from '../../evals/schema';
import { loadConfig, requireLive } from '../../src/config';

const out = mkdtempSync(path.join(tmpdir(), 'rerun-evals-live-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('eval harness (live Jev + Claude)', () => {
  it('`--provider both --scenarios apply-time-exit-1 --perturbations 2` completes and prints a table', async () => {
    requireLive(['jev', 'anthropic'], loadConfig());
    const log = vi.spyOn(console, 'log');
    const file = path.join(out, 'results.json');
    const code = await main([
      '--provider',
      'both',
      '--scenarios',
      'apply-time-exit-1',
      '--perturbations',
      '2',
      '--out',
      file,
    ]);
    const printed = log.mock.calls.flat().join('\n');
    log.mockRestore();

    expect(code).toBe(0);
    const results = evalResultsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(results.providers.map((p) => [p.provider, p.summary.n, p.summary.errors])).toEqual([
      ['jev', 1, 0],
      ['llm', 1, 0],
    ]);
    for (const p of results.providers) expect(p.robustness.runs).toBe(2);
    expect(printed).toMatch(/\| jev \| 1 \| 0 \|/);
    expect(printed).toMatch(/\| llm \| 1 \| 0 \|/);
  });
});
