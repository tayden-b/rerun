import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config';
import { initTelemetry } from '../src/telemetry';
import { resolveDeps, type ProviderName } from './deps';
import { runEval } from './harness';
import { renderMarkdown } from './report';

const HELP = `Usage: npm run eval -- [options]

  --provider jev|llm|both|recorded   default: recorded in demo mode, both otherwise
  --scenarios a,b                    default: every fixtures/scenarios/* with expected.json and mcp/
  --scenarios-dir <dir>              default: fixtures/scenarios
  --perturbations <n>                perturbed runs per scenario per provider (default 5)
  --seed <n>                         perturbation seed (default 42)
  --live                             also run the live end-to-end table (Wave 2)
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
  const providers = (providerArg === 'both' ? ['jev', 'llm'] : providerArg.split(',')) as ProviderName[];
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
    const results = await runEval(
      {
        providers,
        scenarios: values.scenarios?.split(',').filter(Boolean),
        scenariosDir: values['scenarios-dir'] ? path.resolve(values['scenarios-dir']) : undefined,
        perturbations,
        seed,
        live: values.live,
        config,
        log: (line) => console.error(line),
      },
      await resolveDeps(),
    );
    const out = path.resolve(values.out);
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
