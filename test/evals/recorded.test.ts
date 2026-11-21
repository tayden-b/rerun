import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveDeps } from '../../evals/deps';
import { runEval } from '../../evals/harness';
import { renderMarkdown } from '../../evals/report';
import { main } from '../../evals/cli';
import { evalResultsSchema } from '../../evals/schema';
import { keywordProvider, TEST_SCENARIOS_DIR } from './fakes';

const out = mkdtempSync(path.join(tmpdir(), 'rerun-evals-'));
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('eval harness (recorded provider, offline)', () => {
  it('`eval --provider recorded` writes a results.json that validates', async () => {
    const file = path.join(out, 'results.json');
    const code = await main([
      '--provider',
      'recorded',
      '--scenarios-dir',
      TEST_SCENARIOS_DIR,
      '--perturbations',
      '3',
      '--out',
      file,
    ]);
    expect(code).toBe(0);
    const results = evalResultsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

    expect(results.options.providers).toEqual(['recorded']);
    expect(results.options.scenarios).toEqual(['eval-apply-exit', 'eval-undeclared-ref']);
    const [rec] = results.providers;
    expect(rec.provider).toBe('recorded');
    expect(rec.scenarios.map((s) => [s.scenario, s.predicted?.failureClass, s.predicted?.route])).toEqual([
      ['eval-apply-exit', 'apply_runtime', 'autoPr'],
      ['eval-undeclared-ref', 'config_syntax', 'draftPr'],
    ]);
    expect(rec.summary.classAccuracy).toBe(0.5);
    expect(rec.summary.routeAccuracy).toBe(0.5);
    expect(rec.summary.inputTokensMean).toBe(1520);
    expect(rec.calibration.configFixable.n).toBe(2);
    expect(rec.calibration.configFixable.bins).toHaveLength(10);
    expect(rec.robustness).toMatchObject({ runs: 6, flips: 0, flipRate: 0 });
    expect(results.notes.join('\n')).toMatch(/flip rate is 0 by construction/);
  });

  it('derives the stage and routes deterministic providers through perturbations', async () => {
    const deps = await resolveDeps();
    const fake = keywordProvider();
    const results = await runEval(
      { providers: ['llm'], scenariosDir: TEST_SCENARIOS_DIR, perturbations: 2, seed: 1, live: false },
      { ...deps, createProvider: () => fake },
    );
    const [llm] = results.providers;
    expect(llm.scenarios.map((s) => s.predicted?.stage)).toEqual(['apply', 'plan']);
    expect(llm.summary.classAccuracy).toBe(1);
    expect(llm.robustness).toMatchObject({ runs: 4, flips: 0 });
    expect(fake.states).toHaveLength(6);
  });

  it('live rows record the Wave 2 stub as an error with the live columns present', async () => {
    const results = await runEval(
      { providers: ['recorded'], scenariosDir: TEST_SCENARIOS_DIR, perturbations: 0, seed: 1, live: true },
      await resolveDeps(),
    );
    expect(results.live.ran).toBe(true);
    expect(results.live.rows[0]).toMatchObject({
      scenario: 'eval-apply-exit',
      error: 'NotImplemented: Not implemented: wired in Wave 2 integration',
    });
    expect(renderMarkdown(results)).toContain(
      '| Scenario | Reached status | Verifier passed | PR | fixTouches respected | Duration |',
    );
  });
});
