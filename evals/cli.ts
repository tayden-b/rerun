import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { initTelemetry } from '../src/telemetry';
import { productionDeps, type ProviderName } from './deps';
import { runEval, runLiveTable } from './harness';
import { renderMarkdown } from './report';
import { evalResultsSchema, type EvalResults } from './schema';

const HELP = `Usage: npm run eval -- [options]

  --provider jev|llm|both|recorded   default: recorded in demo mode, both otherwise
  --scenarios a,b                    default: every fixtures/scenarios/* with expected.json and mcp/
  --scenarios-dir <dir>              default: fixtures/scenarios
  --perturbations <n>                perturbed runs per scenario per provider (default 5)
  --seed <n>                         perturbation seed (default 42)
  --live                             also run the live end-to-end table (Wave 2)
  --live-only                        run only the live table; keep the provider tables already in --out
  --out <file>                       default: evals/results.json`;

/** `npm run eval`; returns the process exit code. */
export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      provider: { type: 'string' },
      scenarios: { type: 'string' },
      'scenarios-dir': { type: 'string' },
      perturbations: { type: 'string', default: '5' },
      seed: { type: 'string', default: '42' },
      live: { type: 'boolean', default: false },
      'live-only': { type: 'boolean', default: false },
      out: { type: 'string', default: 'evals/results.json' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const config = loadConfig();
  const providerArg = values.provider ?? (config.mode === 'demo' ? 'recorded' : 'both');
  const liveOnly = values['live-only'];
  const providers = (
    liveOnly ? [] : providerArg === 'both' ? ['jev', 'llm'] : providerArg.split(',')
  ) as ProviderName[];
  const perturbations = Number(values.perturbations);
  const seed = Number(values.seed);
  if (
    providers.some((p) => !['jev', 'llm', 'recorded'].includes(p)) ||
    !Number.isInteger(perturbations) ||
    perturbations < 0 ||
    !Number.isInteger(seed)
  ) {
    console.error(HELP);
    return 2;
  }

  const telemetry = initTelemetry();
  try {
    const out = path.resolve(values.out);
    const evalOpts = {
      providers,
      scenarios: values.scenarios?.split(',').filter(Boolean),
      scenariosDir: values['scenarios-dir'] ? path.resolve(values['scenarios-dir']) : undefined,
      perturbations,
      seed,
      live: values.live,
      config,
      log: (line: string) => console.error(line),
    };
    const results = liveOnly
      ? withLive(JSON.parse(readFileSync(out, 'utf8')), await runLiveTable(evalOpts))
      : await runEval(evalOpts, productionDeps);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
    console.log(renderMarkdown(results));
    console.log(`Wrote ${out}`);
    const failed =
      results.providers.some((p) => p.summary.errors === p.summary.n) ||
      results.live.rows.some((r) => r.error);
    return failed ? 1 : 0;
  } finally {
    await telemetry.shutdown();
  }
}

/**
 * The provider tables of an earlier run with these live rows; rows for scenarios not run this time are
 * kept, so the live table can be filled one scenario at a time.
 */
function withLive(previous: unknown, rows: EvalResults['live']['rows']): EvalResults {
  const prev = evalResultsSchema.parse(previous);
  const ran = new Set(rows.map((r) => r.scenario));
  const order = prev.options.scenarios;
  const merged = [...prev.live.rows.filter((r) => !ran.has(r.scenario)), ...rows].sort(
    (a, b) => order.indexOf(a.scenario) - order.indexOf(b.scenario),
  );
  return evalResultsSchema.parse({
    ...prev,
    generatedAt: new Date().toISOString(),
    options: { ...prev.options, live: true },
    live: { ...prev.live, ran: true, rows: merged },
  });
}
