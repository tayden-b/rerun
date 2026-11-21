import type { EvalResults } from './schema';

export const README_START = '<!-- evals:start -->';
export const README_END = '<!-- evals:end -->';

const dash = '—';
const pct = (x: number | null) => (x === null ? dash : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, digits = 2) => (x === null ? dash : x.toFixed(digits));
const ms = (x: number | null) => (x === null ? dash : `${Math.round(x)} ms`);
const usd = (x: number | null) => (x === null ? dash : `$${x < 0.01 ? x.toFixed(6) : x.toFixed(4)}`);
const yesNo = (x: boolean | null) => (x === null ? dash : x ? 'yes' : 'no');

function table(header: string[], rows: string[][]): string {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** Markdown tables for every metric; also used as the console summary. */
export function renderMarkdown(r: EvalResults): string {
  const out: string[] = [];
  const date = r.generatedAt.slice(0, 10);
  out.push(
    `Generated ${date} from \`evals/results.json\`: ${r.options.scenarios.length} scenario(s), ${r.options.perturbations} perturbation(s) per scenario, prices as of ${r.pricesAsOf}.`,
  );

  out.push('### Triage accuracy');
  out.push(
    table(
      [
        'Provider',
        'Scenarios',
        'Errors',
        'Class accuracy',
        'Route accuracy',
        'Mean latency',
        'Mean input tokens',
        'Cost / incident',
      ],
      r.providers.map((p) => [
        p.provider,
        String(p.summary.n),
        String(p.summary.errors),
        pct(p.summary.classAccuracy),
        pct(p.summary.routeAccuracy),
        ms(p.summary.latencyMsMean),
        num(p.summary.inputTokensMean, 0),
        usd(p.summary.costUsdPerIncident),
      ]),
    ),
  );

  out.push('### Per-class precision and recall');
  out.push(
    table(
      ['Provider', 'Class', 'Support', 'Predicted', 'Precision', 'Recall'],
      r.providers.flatMap((p) =>
        p.perClass.map((c) => [
          p.provider,
          `\`${c.failureClass}\``,
          String(c.support),
          String(c.predicted),
          pct(c.precision),
          pct(c.recall),
        ]),
      ),
    ),
  );

  out.push('### Calibration');
  out.push(
    'Outcome: `autoPr` in `expected.json` means config-fixable = 1 and needs-human = 0. ECE = expected calibration error over 0.1-wide bins (lower is better).',
  );
  const signals = [
    ['configFixable', 'config_fixable'],
    ['needsHuman', 'needs_human'],
  ] as const;
  out.push(
    table(
      ['Provider', 'Signal', 'n', 'ECE'],
      r.providers.flatMap((p) =>
        signals.map(([key, label]) => [
          p.provider,
          `\`${label}\``,
          String(p.calibration[key].n),
          num(p.calibration[key].ece),
        ]),
      ),
    ),
  );
  out.push(
    table(
      ['Provider', 'Signal', 'Bin', 'n', 'Mean predicted', 'Observed'],
      r.providers.flatMap((p) =>
        signals.flatMap(([key, label]) =>
          p.calibration[key].bins
            .filter((b) => b.count > 0)
            .map((b) => [
              p.provider,
              `\`${label}\``,
              `${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`,
              String(b.count),
              num(b.meanPredicted),
              num(b.observedRate),
            ]),
        ),
      ),
    ),
  );

  out.push('### Robustness');
  out.push(
    'Each scenario state is perturbed without changing its meaning (consistent resource renames, an extra UUID line, reordered plan entries, whitespace). A flip is a run whose class or route differs from the unperturbed run.',
  );
  out.push(
    table(
      ['Provider', 'Perturbed runs', 'Flips', 'Flip rate'],
      r.providers.map((p) => [
        p.provider,
        String(p.robustness.runs),
        String(p.robustness.flips),
        pct(p.robustness.flipRate),
      ]),
    ),
  );

  out.push('### End-to-end (live)');
  const liveRows = r.live.rows.map((row) => [
    row.scenario,
    row.reachedStatus ?? (row.error ? `error: ${row.error.replace(/\|/g, '\\|')}` : dash),
    yesNo(row.verifierOk),
    row.prUrl ? `[PR](${row.prUrl})` : dash,
    yesNo(row.fixTouchesRespected),
    row.durationMs === null ? dash : `${(row.durationMs / 1000).toFixed(0)} s`,
  ]);
  out.push(
    table(
      ['Scenario', 'Reached status', 'Verifier passed', 'PR', 'fixTouches respected', 'Duration'],
      liveRows.length ? liveRows : [['not run', dash, dash, dash, dash, dash]],
    ),
  );

  if (r.notes.length) out.push(r.notes.map((n) => `- ${n}`).join('\n'));
  return `${out.join('\n\n')}\n`;
}

/** Replaces the text between the evals markers; throws if either marker is missing. */
export function replaceEvalsSection(readme: string, body: string): string {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`README.md must contain ${README_START} followed by ${README_END}`);
  }
  return `${readme.slice(0, start + README_START.length)}\n\n${body.trim()}\n\n${readme.slice(end)}`;
}
