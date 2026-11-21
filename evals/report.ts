import { ALLOWED_TOOLS, REGISTRY_TOOLS, type AllowedTool } from '../src/mcp/allowlist';
import type { EvalResults, ProviderResult, ScenarioResult } from './schema';

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
export function renderMarkdown(r: EvalResults, opts: { baseline?: EvalResults } = {}): string {
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
        'Triage cost / incident',
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

  out.push('### Accuracy per failure class');
  out.push(
    'Correct `failure_class` answers out of the scenarios of that class. Each cell is one provider on the same recorded MCP data.',
  );
  out.push(renderPerClass(r));

  if (opts.baseline) {
    out.push('### Question rewording: before and after');
    out.push(renderRewording(opts.baseline, r));
  }

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
  if (r.live.rows.length) {
    const reached = r.live.rows.filter((row) => row.verifierOk && row.prUrl).length;
    out.push(
      `Each scenario broken on the real workspace, then run through Rerun. ${reached} of ${r.live.rows.length} reached a passing verifier and an open PR.`,
    );
  }
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

const MCP_TOOL_USES: Record<AllowedTool, { use: string; calledFrom: string | null }> = {
  list_workspaces: {
    use: 'Not called; the scope guard only allows a filter on the watched workspace.',
    calledFrom: null,
  },
  get_workspace_details: {
    use: 'Resolves the workspace id that state reads need; part of every incident context.',
    calledFrom: '`collectRunArtifacts`',
  },
  list_runs: {
    use: 'Polls for newly errored runs and for the run after a merge.',
    calledFrom: '`src/watch/runs.ts`',
  },
  get_run_details: {
    use: 'Run status, message and the plan and apply ids; proves the run belongs to the watched workspace.',
    calledFrom: '`collectRunArtifacts`',
  },
  get_plan_details: {
    use: 'Plan status: did the run fail in init/plan or get past it.',
    calledFrom: '`collectRunArtifacts`',
  },
  get_plan_logs: {
    use: 'The failing log, from which the 120-line error excerpt is cut.',
    calledFrom: '`collectRunArtifacts`',
  },
  get_plan_json_output: {
    use: 'Planned resource changes for the blast-radius question. Scrubbed of private keys first.',
    calledFrom: '`collectRunArtifacts`',
  },
  get_apply_details: { use: 'Apply status, when the plan succeeded.', calledFrom: '`collectRunArtifacts`' },
  get_apply_logs: {
    use: 'The apply-time error (provisioners, API calls during apply).',
    calledFrom: '`collectRunArtifacts`',
  },
  list_state_versions: {
    use: 'Not called by the incident flow; the scope guard uses it to check an explicit state version id.',
    calledFrom: null,
  },
  get_state_version: {
    use: 'Current state outputs and resources, for the Reality agent.',
    calledFrom: '`collectRunArtifacts`',
  },
  get_run_comments: { use: 'Not called yet; exposed for a comment-back surface.', calledFrom: null },
  whoami: { use: 'Identity check when recording fixtures.', calledFrom: '`scripts/record.ts`' },
  search_provider_docs: {
    use: 'Finds the provider doc for an argument or attribute named in the error.',
    calledFrom: 'Config and Fix agents',
  },
  get_provider_details: {
    use: 'Reads that doc page, e.g. which tls v4 attributes are read-only.',
    calledFrom: 'Config and Fix agents',
  },
  get_latest_provider_version: {
    use: 'Not called yet; exposed for version-conflict fixes.',
    calledFrom: null,
  },
  get_provider_capabilities: { use: 'Not called yet; exposed for version-conflict fixes.', calledFrom: null },
};

/** Tools Rerun actually calls, in allowlist order. */
export const CALLED_MCP_TOOLS = ALLOWED_TOOLS.filter((t) => MCP_TOOL_USES[t].calledFrom !== null);

/** The allowlist (`src/mcp/allowlist.ts`) as a README table. */
export function renderMcpTools(): string {
  const registry = REGISTRY_TOOLS as readonly string[];
  return table(
    ['Tool', 'Toolset', 'What Rerun uses it for', 'Called from'],
    ALLOWED_TOOLS.map((t) => [
      `\`${t}\``,
      registry.includes(t) ? 'registry' : 'terraform',
      MCP_TOOL_USES[t].use,
      MCP_TOOL_USES[t].calledFrom ?? dash,
    ]),
  );
}

/** The Jev view of a results file: live `jev` answers, else the recorded Jev answers. */
function jevView(r: EvalResults): ProviderResult | undefined {
  return r.providers.find((p) => p.provider === 'jev') ?? r.providers.find((p) => p.provider === 'recorded');
}

const ratio = (k: number, n: number) => (n === 0 ? dash : `${k}/${n}`);

function renderPerClass(r: EvalResults): string {
  const classes = [...new Set(r.providers.flatMap((p) => p.scenarios.map((s) => s.expected.failureClass)))];
  return table(
    ['Class', 'Scenarios', ...r.providers.map((p) => p.provider)],
    classes.map((c) => {
      const counts = r.providers.map((p) => {
        const of = p.scenarios.filter((s) => s.expected.failureClass === c);
        return ratio(of.filter((s) => s.classCorrect).length, of.length);
      });
      const support = r.providers[0].scenarios.filter((s) => s.expected.failureClass === c).length;
      return [`\`${c}\``, String(support), ...counts];
    }),
  );
}

function renderRewording(before: EvalResults, after: EvalResults): string {
  const b = jevView(before);
  const a = jevView(after);
  if (!b || !a) return 'No Jev answers in one of the two runs.';
  const byName = (p: ProviderResult) => new Map(p.scenarios.map((s) => [s.scenario, s]));
  const bm = byName(b);
  const am = byName(a);
  const names = [...new Set([...bm.keys(), ...am.keys()])];
  const cell = (s: ScenarioResult | undefined, f: (x: NonNullable<ScenarioResult['predicted']>) => string) =>
    s?.predicted ? f(s.predicted) : dash;
  const matches = (m: Map<string, ScenarioResult>) => [...m.values()].filter((s) => s.routeCorrect).length;
  const rows = names.map((n) => {
    const x = bm.get(n);
    const y = am.get(n);
    const expected = (x ?? y)!.expected.route;
    return [
      `\`${n}\``,
      `\`${expected}\``,
      cell(x, (p) => num(p.configFixable)),
      cell(y, (p) => num(p.configFixable)),
      cell(x, (p) => num(p.needsHuman)),
      cell(y, (p) => num(p.needsHuman)),
      cell(x, (p) => `\`${p.route}\``),
      cell(y, (p) => `\`${p.route}\``),
    ];
  });
  rows.push([
    'Route matches expected',
    '',
    '',
    '',
    '',
    '',
    ratio(matches(bm), bm.size),
    ratio(matches(am), am.size),
  ]);
  return [
    `Same scenarios and SPEC §4 thresholds (\`autoPr\` iff \`config_fixable\` ≥ 0.70, \`blast_radius\` ≤ 1.0, \`needs_human\` ≤ 0.40); only the question wording changed. Before: ${b.provider} answers of ${before.generatedAt.slice(0, 10)}. After: ${a.provider} answers of ${after.generatedAt.slice(0, 10)}.`,
    table(
      [
        'Scenario',
        'Expected',
        '`config_fixable` before',
        'after',
        '`needs_human` before',
        'after',
        'Route before',
        'after',
      ],
      rows,
    ),
  ].join('\n\n');
}

/** shields.io endpoint badges (`https://img.shields.io/endpoint?url=...`). */
export function renderBadges(
  r: EvalResults,
): Record<string, { schemaVersion: 1; label: string; message: string; color: string }> {
  const p = jevView(r);
  const n = p?.summary.n ?? 0;
  const correct = (f: (s: ScenarioResult) => boolean) => p?.scenarios.filter(f).length ?? 0;
  return {
    'eval.json': {
      schemaVersion: 1,
      label: 'triage eval',
      message: p
        ? `class ${correct((s) => s.classCorrect)}/${n} · route ${correct((s) => s.routeCorrect)}/${n}`
        : 'not run',
      color: '3b82f6',
    },
    'mcp-tools.json': {
      schemaVersion: 1,
      label: 'Terraform MCP',
      message: `${CALLED_MCP_TOOLS.length} tools used, ${ALLOWED_TOOLS.length} allowed`,
      color: '7b42bc',
    },
  };
}

/** Replaces the text between `<!-- <name>:start -->` and `<!-- <name>:end -->`; throws if a marker is missing. */
export function replaceSection(readme: string, name: string, body: string): string {
  const startMarker = `<!-- ${name}:start -->`;
  const endMarker = `<!-- ${name}:end -->`;
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`README.md must contain ${startMarker} followed by ${endMarker}`);
  }
  return `${readme.slice(0, start + startMarker.length)}\n\n${body.trim()}\n\n${readme.slice(end)}`;
}

/** Replaces the text between the evals markers; throws if either marker is missing. */
export function replaceEvalsSection(readme: string, body: string): string {
  return replaceSection(readme, 'evals', body);
}
