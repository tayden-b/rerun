import { redact } from '../shared/redact';
import type { Diagnosis, Patch, StepOutput, TriageResult, VerifyResult } from '../shared/types';

export interface PrBodyInput {
  triage: TriageResult;
  diagnoses: Diagnosis[];
  patch: Patch;
  verify: VerifyResult;
  runUrl: string;
  incidentUrl: string;
}

const MAX_OUTPUT_CHARS = 20_000;
const AGENT_LABEL: Record<Diagnosis['agent'], string> = { config: 'Config agent', reality: 'Reality agent' };

/** Pull request body for a Rerun fix: what failed, why, what changed, the verifier proof, and Jev's read. */
export function renderPrBody(input: PrBodyInput): string {
  const { triage, diagnoses, patch, verify, runUrl, incidentUrl } = input;
  const sections = [
    `> Opened by Rerun. Review the evidence below, then approve in the [Rerun incident](${incidentUrl}).`,
    whatFailed(triage, runUrl),
    why(diagnoses),
    whatChanged(patch),
    verification(verify),
    decision(triage),
    `---\n[View the full investigation in Rerun](${incidentUrl})`,
  ];
  return redact(sections.join('\n\n') + '\n');
}

function whatFailed(triage: TriageResult, runUrl: string): string {
  return [
    '## What failed',
    `The [HCP Terraform run](${runUrl}) errored during **${triage.stage}**. ` +
      `Classified as \`${triage.failureClass.choice}\` (${pct(triage.failureClass.confidence)} confidence).`,
    fence(triage.errorExcerpt.trim(), 'text'),
  ].join('\n\n');
}

function why(diagnoses: Diagnosis[]): string {
  if (diagnoses.length === 0) return '## Why\n\nNo diagnosis was recorded.';
  const parts = diagnoses.map((d) => {
    const evidence = d.evidence
      .map((e) => `  - \`${e.kind}\` ${inline(e.ref)}: ${inline(e.excerpt)}`)
      .join('\n');
    return [
      `- **${AGENT_LABEL[d.agent]}** (${pct(d.confidence)} confidence): ${inline(d.rootCause)}`,
      evidence,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return ['## Why', parts.join('\n')].join('\n\n');
}

function whatChanged(patch: Patch): string {
  const rows = patch.files.map(
    (f) => `| \`${cell(f.path)}\` | ${f.before === null ? 'added' : 'modified'} | ${cell(f.rationale)} |`,
  );
  return [
    '## What changed',
    patch.summary.trim(),
    ['| File | Change | Why |', '| --- | --- | --- |', ...rows].join('\n'),
  ].join('\n\n');
}

function verification(verify: VerifyResult): string {
  const steps: [string, StepOutput][] = [
    ['`terraform fmt -check`', verify.fmt],
    ['`terraform init` + `validate`', verify.validate],
    ['`terraform plan` (speculative)', verify.plan],
  ];
  const rows = steps.map(
    ([label, s]) => `| ${label} | ${stepStatus(s)} | ${s.exitCode} | ${seconds(s.durationMs)} |`,
  );
  const ran = steps.filter(([, s]) => s.exitCode !== -1);
  const output = ran
    .map(
      ([label, s]) =>
        `${label.replaceAll('`', '')}\n${truncate([s.stdout, s.stderr].filter(Boolean).join('\n').trim() || '(no output)')}`,
    )
    .join('\n\n');
  return [
    '## Verification',
    `**${verify.ok ? 'Passed' : 'Failed'}**: ${inline(verify.summary)}`,
    ['| Step | Result | Exit | Time |', '| --- | --- | --- | --- |', ...rows].join('\n'),
    `<details>\n<summary>Verifier output</summary>\n\n${fence(output.trim(), 'text')}\n\n</details>`,
  ].join('\n\n');
}

function decision(triage: TriageResult): string {
  const probs = Object.entries(triage.failureClass.probabilities)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([cls, p]) => `| \`${cell(cls)}\` | ${pct(p)} |`);
  const blast = triage.blastRadius;
  const blastLabel = blast.legend[String(blast.score)];
  const source = {
    jev: 'Jev (TypeSafe System One)',
    llm: 'LLM decision provider',
    recorded: 'recorded answer',
  };
  return [
    '## Decision',
    `Triage by ${source[triage.provider]}.`,
    ['| Failure class | Probability |', '| --- | --- |', ...probs].join('\n'),
    [
      '| Signal | Value |',
      '| --- | --- |',
      `| Fixable in config | ${pct(triage.configFixable.noul)} |`,
      `| Needs a human | ${pct(triage.needsHuman.noul)} |`,
      `| Blast radius | ${blast.score}${blastLabel ? ` (${cell(blastLabel)})` : ''} |`,
    ].join('\n'),
  ].join('\n\n');
}

function stepStatus(s: StepOutput): string {
  if (s.exitCode === -1) return 'skipped';
  return s.ok ? 'pass' : 'fail';
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function inline(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function cell(text: string): string {
  return inline(text).replaceAll('|', '\\|');
}

function truncate(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (${text.length - MAX_OUTPUT_CHARS} more characters truncated)`;
}

/** Code fence that cannot be closed early by backticks in the content. */
function fence(text: string, lang: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${text}\n${ticks}`;
}
