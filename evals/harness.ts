import { loadConfig, type Config } from '../src/config';
import { redact } from '../src/shared/redact';
import type { TriageResult } from '../src/shared/types';
import { estimateCostUsd, jevCostUsd, PRICES_AS_OF } from '../src/telemetry/cost';
import type { EvalDeps, ProviderName } from './deps';
import { DEFAULT_SCENARIOS_DIR, loadScenarios, type Scenario } from './fixtures';
import { runLiveScenario as defaultRunLive, type RunLiveScenario } from './live';
import { accuracy, calibration, flipRate, mean, perClass, type Outcome, type Verdict } from './metrics';
import { hashString, perturbingProvider } from './perturb';
import {
  evalResultsSchema,
  type EvalResults,
  type LiveRow,
  type ProviderResult,
  type ScenarioResult,
} from './schema';

export interface EvalOptions {
  providers: ProviderName[];
  scenariosDir?: string;
  scenarios?: string[];
  perturbations: number;
  seed: number;
  live: boolean;
  config?: Config;
  runLive?: RunLiveScenario;
  now?: () => Date;
  log?: (line: string) => void;
}

function decisionCostUsd(provider: ProviderName, inputTokens: number, config: Config): number {
  // `recorded` replays a Jev answer, so it is priced as the live Jev call it stands in for.
  if (provider === 'llm') return estimateCostUsd({ model: config.models.fast, inputTokens, outputTokens: 0 });
  return jevCostUsd(inputTokens);
}

const errorMessage = (err: unknown) =>
  redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err));

async function runOne(
  deps: EvalDeps,
  provider: ProviderName,
  scenario: Scenario,
  config: Config,
  seed?: number,
): Promise<{ triage: TriageResult; verdict: Verdict }> {
  const base = deps.createProvider(provider, scenario, config);
  const p = seed === undefined ? base : perturbingProvider(base, seed);
  const triage = await deps.triage(structuredClone(scenario.context), p);
  return { triage, verdict: { failureClass: triage.failureClass.choice, route: deps.route(triage) } };
}

async function evalProvider(
  deps: EvalDeps,
  provider: ProviderName,
  scenarios: Scenario[],
  opts: EvalOptions,
  config: Config,
): Promise<ProviderResult> {
  const rows: ScenarioResult[] = [];
  const baselines = new Map<string, Verdict>();
  for (const s of scenarios) {
    const expected = {
      failureClass: s.expected.failureClass,
      stage: s.expected.stage,
      route: s.expected.route,
    };
    try {
      const { triage, verdict } = await runOne(deps, provider, s, config);
      baselines.set(s.name, verdict);
      rows.push({
        scenario: s.name,
        placeholder: s.placeholder,
        expected,
        predicted: {
          failureClass: verdict.failureClass,
          classConfidence: triage.failureClass.confidence,
          stage: triage.stage,
          route: verdict.route,
          configFixable: triage.configFixable.noul,
          needsHuman: triage.needsHuman.noul,
          blastRadius: triage.blastRadius.score,
        },
        classCorrect: verdict.failureClass === expected.failureClass,
        routeCorrect: verdict.route === expected.route,
        latencyMs: triage.latencyMs,
        inputTokens: triage.inputTokens,
        costUsd: decisionCostUsd(provider, triage.inputTokens, config),
      });
    } catch (err) {
      opts.log?.(`  ${provider} ${s.name}: ${errorMessage(err)}`);
      rows.push({
        scenario: s.name,
        placeholder: s.placeholder,
        expected,
        predicted: null,
        classCorrect: false,
        routeCorrect: false,
        latencyMs: 0,
        inputTokens: 0,
        costUsd: 0,
        error: errorMessage(err),
      });
    }
  }

  const ok = rows.filter((r) => r.predicted !== null);
  const outcomes: Outcome[] = rows.map((r) => ({ expected: r.expected, predicted: r.predicted }));
  const autoPr = (r: ScenarioResult): 0 | 1 => (r.expected.route === 'autoPr' ? 1 : 0);

  const perScenario: ProviderResult['robustness']['perScenario'] = [];
  for (const s of scenarios) {
    const baseline = baselines.get(s.name);
    if (!baseline || opts.perturbations === 0) continue;
    const verdicts: Verdict[] = [];
    for (let i = 0; i < opts.perturbations; i++) {
      try {
        verdicts.push(
          (await runOne(deps, provider, s, config, opts.seed + i * 7919 + hashString(s.name))).verdict,
        );
      } catch (err) {
        opts.log?.(`  ${provider} ${s.name} perturbation ${i + 1}: ${errorMessage(err)}`);
      }
    }
    perScenario.push({ scenario: s.name, runs: verdicts.length, flips: flipRate(baseline, verdicts).flips });
  }
  const runs = perScenario.reduce((a, r) => a + r.runs, 0);
  const flips = perScenario.reduce((a, r) => a + r.flips, 0);
  const costUsdTotal = ok.reduce((a, r) => a + r.costUsd, 0);

  return {
    provider,
    scenarios: rows,
    summary: {
      n: rows.length,
      errors: rows.length - ok.length,
      ...accuracy(outcomes),
      latencyMsMean: mean(ok.map((r) => r.latencyMs)),
      inputTokensMean: mean(ok.map((r) => r.inputTokens)),
      costUsdTotal,
      costUsdPerIncident: ok.length ? costUsdTotal / ok.length : null,
    },
    perClass: perClass(outcomes),
    calibration: {
      configFixable: calibration(ok.map((r) => ({ p: r.predicted!.configFixable, y: autoPr(r) }))),
      needsHuman: calibration(ok.map((r) => ({ p: r.predicted!.needsHuman, y: (1 - autoPr(r)) as 0 | 1 }))),
    },
    robustness: {
      perturbations: opts.perturbations,
      runs,
      flips,
      flipRate: runs ? flips / runs : null,
      perScenario,
    },
  };
}

async function evalLive(
  scenarios: Scenario[],
  runLive: RunLiveScenario,
  log?: (l: string) => void,
): Promise<LiveRow[]> {
  const rows: LiveRow[] = [];
  for (const s of scenarios) {
    try {
      const r = await runLive(s.name);
      rows.push({
        scenario: s.name,
        reachedStatus: r.reachedStatus,
        verifierOk: r.verifierOk,
        prUrl: r.prUrl,
        fixTouchesRespected: r.fixTouchesRespected ?? null,
        durationMs: r.durationMs,
      });
    } catch (err) {
      log?.(`  live ${s.name}: ${errorMessage(err)}`);
      rows.push({
        scenario: s.name,
        reachedStatus: null,
        verifierOk: null,
        prUrl: null,
        fixTouchesRespected: null,
        durationMs: null,
        error: errorMessage(err),
      });
    }
  }
  return rows;
}

/** Runs triage accuracy, calibration, robustness (and optionally live e2e); returns schema-validated results. */
export async function runEval(opts: EvalOptions, deps: EvalDeps): Promise<EvalResults> {
  const config = opts.config ?? loadConfig();
  const scenarios = loadScenarios(opts.scenariosDir ?? DEFAULT_SCENARIOS_DIR, opts.scenarios);
  if (scenarios.length === 0)
    throw new Error(
      `No scenarios with expected.json and mcp/ in ${opts.scenariosDir ?? DEFAULT_SCENARIOS_DIR}`,
    );

  const providers: ProviderResult[] = [];
  for (const provider of opts.providers) {
    opts.log?.(`${provider}: ${scenarios.length} scenario(s), ${opts.perturbations} perturbation(s) each`);
    providers.push(await evalProvider(deps, provider, scenarios, opts, config));
  }
  const liveRows = opts.live ? await evalLive(scenarios, opts.runLive ?? defaultRunLive, opts.log) : [];

  const notes = [`triage: ${deps.sources.triage}; route: ${deps.sources.route}.`];
  const placeholders = scenarios.filter((s) => s.placeholder).length;
  if (placeholders)
    notes.push(`${placeholders} of ${scenarios.length} scenario(s) use placeholder fixtures.`);
  if (opts.providers.includes('recorded')) {
    notes.push('The recorded provider replays a fixed answer, so its flip rate is 0 by construction.');
  }
  if (opts.providers.includes('llm')) {
    notes.push(
      'LLM decision cost counts input tokens only (DecisionProvider does not report output tokens).',
    );
  }

  return evalResultsSchema.parse({
    schemaVersion: 1,
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    options: {
      providers: opts.providers,
      scenarios: scenarios.map((s) => s.name),
      perturbations: opts.perturbations,
      seed: opts.seed,
      live: opts.live,
    },
    pricesAsOf: PRICES_AS_OF,
    providers,
    live: { ran: opts.live, rows: liveRows },
    notes,
  });
}
