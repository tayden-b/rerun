import './load-env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { schema, type Db } from '../src/db';
import { addArtifact, addDecision, appendEvent, createIncident, setStatus } from '../src/db/incidents';
import type {
  Diagnosis,
  IncidentEvent,
  IncidentStatus,
  Patch,
  PullRequest,
  Route,
  Stage,
  TriageResult,
  VerifyResult,
  FailureClass,
} from '../src/shared/types';

// `npm run seed:demo`: three deterministic incidents for the dashboard, screenshots and Playwright.
// The awaiting-approval incident is built from fixtures/scenarios/apply-time-exit-1; the other two are
// modelled on the rerun-fixtures `unset-variable` and `provider-version-conflict` scenarios.

const SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');
const AGENT_MODEL = 'claude-sonnet-5-5';
const MINUTE = 60_000;

export const DEMO_INCIDENT_IDS = {
  awaiting: 'demo-awaiting-approval',
  resolved: 'demo-resolved',
  needsHuman: 'demo-needs-human',
} as const;

function fixture<T>(scenario: string, file: string): T {
  return JSON.parse(readFileSync(path.join(SCENARIOS_DIR, scenario, file), 'utf8')) as T;
}

interface ToolStep {
  tool: string;
  args: Record<string, unknown>;
  output: unknown;
  durationMs: number;
  ok?: boolean;
}

interface AgentScript {
  task: string;
  tools: ToolStep[];
  diagnosis: Omit<Diagnosis, 'agent' | 'steps'>;
  usage: { inputTokens: number; outputTokens: number };
}

interface Scenario {
  id: string;
  runId: string;
  workspace: string;
  minutesAgo: number;
  finalStatus: IncidentStatus;
  failureClass: FailureClass;
  stage: Stage;
  route: Route;
  costUsd: number;
  collect: ToolStep[];
  triage: TriageResult;
  jevRequest: unknown;
  config: AgentScript;
  reality: AgentScript;
  patch: Patch;
  fixUsage: { inputTokens: number; outputTokens: number };
  verify: VerifyResult;
  pr: PullRequest;
  confirm?: { runId: string; status: string };
}

type Jev = {
  answers: {
    failure_class: { choice: FailureClass; confidence: number; probabilities: Record<string, number> };
    config_fixable: { noul: number };
    blast_radius: TriageResult['blastRadius'];
    needs_human: { noul: number };
  };
  inputTokens: number;
  latencyMs: number;
};

/** The `Error:` block of a Terraform log (between the box-drawing markers), without the gutter. */
export function errorExcerpt(log: string): string {
  const lines = log.split('\n');
  const start = lines.findIndex((l) => l.startsWith('╷'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('╵'));
  if (start < 0 || end < 0) return lines.slice(-8).join('\n').trim();
  return lines
    .slice(start + 1, end)
    .map((l) => l.replace(/^│ ?/, ''))
    .join('\n')
    .trim();
}

function triageFrom(jev: Jev, stage: Stage, excerpt: string): TriageResult {
  return {
    failureClass: jev.answers.failure_class,
    configFixable: jev.answers.config_fixable,
    blastRadius: jev.answers.blast_radius,
    needsHuman: jev.answers.needs_human,
    stage,
    errorExcerpt: excerpt,
    provider: 'jev',
    inputTokens: jev.inputTokens,
    latencyMs: jev.latencyMs,
  };
}

const JEV_REQUEST = {
  questions: ['failure_class', 'config_fixable', 'blast_radius', 'needs_human'],
};

function ok(stdout: string, durationMs: number, exitCode = 0) {
  return { ok: exitCode === 0, exitCode, stdout, stderr: '', durationMs };
}

function applyTimeExit1(): Scenario {
  const scenario = 'apply-time-exit-1';
  const run = fixture<{ result: { id: string } }>(scenario, 'mcp/get_run_details.json').result;
  const log = fixture<{ result: string }>(scenario, 'mcp/get_apply_logs.json').result;
  const plan = fixture<{ result: unknown }>(scenario, 'mcp/get_plan_json_output.json').result;
  const expected = fixture<{ failureClass: FailureClass; stage: Stage; route: Route; humanSummary: string }>(
    scenario,
    'expected.json',
  );
  const jev = fixture<Jev>(scenario, 'jev.json');
  const excerpt = errorExcerpt(log);

  const before = [
    'resource "random_pet" "service" {',
    '  length = 2',
    '}',
    '',
    'resource "terraform_data" "bootstrap" {',
    '  input = var.workspace_name',
    '',
    '  provisioner "local-exec" {',
    '    command = "echo bootstrapping ${var.workspace_name} && exit 1"',
    '  }',
    '}',
    '',
  ].join('\n');
  const after = before.replace(' && exit 1"', '"');

  return {
    id: DEMO_INCIDENT_IDS.awaiting,
    runId: run.id,
    workspace: 'rerun-fixtures',
    minutesAgo: 4,
    finalStatus: 'awaiting_approval',
    failureClass: expected.failureClass,
    stage: expected.stage,
    route: expected.route,
    costUsd: 0.37,
    collect: [
      { tool: 'get_run_details', args: { run_id: run.id }, output: run, durationMs: 412 },
      { tool: 'get_plan_json_output', args: { run_id: run.id }, output: plan, durationMs: 655 },
      { tool: 'get_apply_logs', args: { run_id: run.id }, output: log, durationMs: 538 },
      {
        tool: 'get_workspace_details',
        args: { workspace_name: 'rerun-fixtures' },
        output: { name: 'rerun-fixtures', terraformVersion: '1.14.3', vcsRepo: 'tayden-b/rerun-fixtures' },
        durationMs: 301,
      },
    ],
    triage: triageFrom(jev, expected.stage, excerpt),
    jevRequest: JEV_REQUEST,
    config: {
      task: 'Find the configuration that makes terraform_data.bootstrap fail during apply.',
      tools: [
        {
          tool: 'list_files',
          args: { path: '.' },
          output: ['main.tf', 'variables.tf', 'versions.tf'],
          durationMs: 38,
        },
        { tool: 'read_file', args: { path: 'main.tf' }, output: before, durationMs: 41 },
        {
          tool: 'search_provider_docs',
          args: { provider: 'terraform', query: 'local-exec provisioner failure behaviour' },
          output: 'Provisioners that exit non-zero fail the resource unless on_failure = continue.',
          durationMs: 880,
        },
      ],
      diagnosis: {
        rootCause:
          'The local-exec provisioner on terraform_data.bootstrap runs a command that ends in `exit 1`, so every apply fails after the resource is created.',
        evidence: [
          {
            kind: 'log',
            ref: 'apply log',
            excerpt: "Error running command 'echo bootstrapping rerun-fixtures && exit 1'",
          },
          {
            kind: 'file',
            ref: 'main.tf:9',
            excerpt: 'command = "echo bootstrapping ${var.workspace_name} && exit 1"',
          },
        ],
        suggestedChange: 'Drop `&& exit 1` from the provisioner command.',
        confidence: 0.91,
      },
      usage: { inputTokens: 18_420, outputTokens: 1_210 },
    },
    reality: {
      task: 'Check what the failed apply left behind in state and whether a rerun is safe.',
      tools: [
        {
          tool: 'get_apply_details',
          args: { run_id: run.id },
          output: { status: 'errored', resourcesAdded: 0 },
          durationMs: 344,
        },
        {
          tool: 'list_state_versions',
          args: { workspace_name: 'rerun-fixtures', limit: 1 },
          output: [{ serial: 41, createdAt: '2026-11-20T14:31:07.000Z' }],
          durationMs: 297,
        },
        {
          tool: 'get_state_version',
          args: { serial: 41 },
          output: { resources: ['random_pet.service', 'tls_private_key.ca'], tainted: [] },
          durationMs: 512,
        },
      ],
      diagnosis: {
        rootCause:
          'State is unchanged since serial 41; terraform_data.bootstrap was never recorded, so a rerun only creates it again.',
        evidence: [
          { kind: 'state', ref: 'state v41', excerpt: 'resources: random_pet.service, tls_private_key.ca' },
        ],
        suggestedChange: 'No state repair needed.',
        confidence: 0.84,
      },
      usage: { inputTokens: 9_870, outputTokens: 640 },
    },
    patch: {
      title: 'Remove the forced exit from the bootstrap provisioner',
      summary: expected.humanSummary,
      files: [
        {
          path: 'main.tf',
          before,
          after,
          rationale:
            'The provisioner command ended in `exit 1`, which fails every apply. Removing it keeps the bootstrap message and lets the apply finish.',
        },
      ],
    },
    fixUsage: { inputTokens: 12_310, outputTokens: 930 },
    verify: {
      ok: true,
      summary: 'fmt, validate and a speculative plan passed. Plan: 1 to add, 0 to change, 0 to destroy.',
      fmt: ok('', 412),
      validate: ok('Success! The configuration is valid.', 1_920),
      plan: ok(
        [
          'Running plan in HCP Terraform (speculative).',
          '',
          'random_pet.service: Refreshing state... [id=bold-otter]',
          'tls_private_key.ca: Refreshing state... [id=4f3c2a1b]',
          '',
          'Terraform will perform the following actions:',
          '',
          '  # terraform_data.bootstrap will be created',
          '  + resource "terraform_data" "bootstrap" {',
          '      + id     = (known after apply)',
          '      + input  = "rerun-fixtures"',
          '      + output = (known after apply)',
          '    }',
          '',
          'Plan: 1 to add, 0 to change, 0 to destroy.',
        ].join('\n'),
        18_400,
      ),
    },
    pr: {
      number: 12,
      url: 'https://github.com/tayden-b/rerun-fixtures/pull/12',
      branch: `rerun/fix-${run.id}`,
      draft: false,
    },
  };
}

function unsetVariable(): Scenario {
  const runId = 'run-hQ7cX2mPq9VtRz4L';
  const log = [
    'Terraform v1.14.3',
    'on linux_amd64',
    '╷',
    '│ Error: No value for required variable',
    '│',
    '│   on variables.tf line 1:',
    '│    1: variable "environment" {',
    '│',
    '│ The root module input variable "environment" is not set, and has no default value.',
    '╵',
  ].join('\n');
  const before = [
    'variable "environment" {',
    '  description = "Deployment environment used in names and tags."',
    '  type        = string',
    '}',
    '',
  ].join('\n');
  const after = before.replace(
    '  type        = string\n',
    '  type        = string\n  default     = "demo"\n',
  );
  return {
    id: DEMO_INCIDENT_IDS.resolved,
    runId,
    workspace: 'rerun-fixtures',
    minutesAgo: 140,
    finalStatus: 'resolved',
    failureClass: 'missing_input',
    stage: 'plan',
    route: 'autoPr',
    costUsd: 0.21,
    collect: [
      {
        tool: 'get_run_details',
        args: { run_id: runId },
        output: { id: runId, status: 'errored' },
        durationMs: 388,
      },
      { tool: 'get_plan_logs', args: { run_id: runId }, output: log, durationMs: 471 },
    ],
    triage: {
      failureClass: {
        choice: 'missing_input',
        confidence: 0.93,
        probabilities: { missing_input: 0.93, config_reference: 0.04, unknown: 0.03 },
      },
      configFixable: { noul: 0.9 },
      blastRadius: {
        score: 0.05,
        confidence: 0.9,
        probabilities: { '0': 0.95, '1': 0.05, '2': 0, '3': 0 },
        legend: {
          '0': 'Nothing is destroyed or replaced',
          '1': 'Only stateless resources',
          '2': 'Stateful',
          '3': 'Data-bearing',
        },
      },
      needsHuman: { noul: 0.08 },
      stage: 'plan',
      errorExcerpt: errorExcerpt(log),
      provider: 'jev',
      inputTokens: 1_610,
      latencyMs: 844,
    },
    jevRequest: JEV_REQUEST,
    config: {
      task: 'Find why the root module input "environment" has no value.',
      tools: [{ tool: 'read_file', args: { path: 'variables.tf' }, output: before, durationMs: 36 }],
      diagnosis: {
        rootCause:
          'The default for variable "environment" was removed and the workspace sets no value for it.',
        evidence: [{ kind: 'file', ref: 'variables.tf:1', excerpt: 'variable "environment" {' }],
        suggestedChange: 'Restore `default = "demo"`.',
        confidence: 0.95,
      },
      usage: { inputTokens: 7_200, outputTokens: 410 },
    },
    reality: {
      task: 'Confirm the workspace does not define the variable.',
      tools: [
        {
          tool: 'get_workspace_details',
          args: { workspace_name: 'rerun-fixtures' },
          output: { variables: [] },
          durationMs: 290,
        },
      ],
      diagnosis: {
        rootCause: 'The workspace has no variable named environment.',
        evidence: [{ kind: 'docs', ref: 'workspace variables', excerpt: '[]' }],
        suggestedChange: 'Fix in configuration.',
        confidence: 0.88,
      },
      usage: { inputTokens: 4_100, outputTokens: 220 },
    },
    patch: {
      title: 'Restore the default for the environment variable',
      summary: 'The plan fails because variable "environment" has no default and the workspace sets none.',
      files: [
        {
          path: 'variables.tf',
          before,
          after,
          rationale:
            'Restores the `demo` default the configuration relied on. No workspace variable is needed.',
        },
      ],
    },
    fixUsage: { inputTokens: 6_800, outputTokens: 380 },
    verify: {
      ok: true,
      summary: 'fmt, validate and a speculative plan passed. Plan: 0 to add, 0 to change, 0 to destroy.',
      fmt: ok('', 390),
      validate: ok('Success! The configuration is valid.', 1_700),
      plan: ok('No changes. Your infrastructure matches the configuration.', 15_200),
    },
    pr: {
      number: 11,
      url: 'https://github.com/tayden-b/rerun-fixtures/pull/11',
      branch: `rerun/fix-${runId}`,
      draft: false,
    },
    confirm: { runId: 'run-Nw3sKd8YfB1gTx6E', status: 'applied' },
  };
}

function providerVersionConflict(): Scenario {
  const runId = 'run-Lr5vE8nJw2QzYc9H';
  const log = [
    'Initializing provider plugins...',
    '╷',
    '│ Error: Failed to query available provider packages',
    '│',
    '│ Could not retrieve the list of available versions for provider hashicorp/random: no available',
    '│ releases match the given constraints ~> 2.0, >= 3.6.0',
    '╵',
  ].join('\n');
  const before = [
    'terraform {',
    '  required_providers {',
    '    random = {',
    '      source  = "hashicorp/random"',
    '      version = "~> 2.0"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const after = before.replace('"~> 2.0"', '"~> 3.6"');
  return {
    id: DEMO_INCIDENT_IDS.needsHuman,
    runId,
    workspace: 'rerun-fixtures',
    minutesAgo: 27,
    finalStatus: 'needs_human',
    failureClass: 'provider_version',
    stage: 'init',
    route: 'draftPr',
    costUsd: 0.44,
    collect: [
      {
        tool: 'get_run_details',
        args: { run_id: runId },
        output: { id: runId, status: 'errored' },
        durationMs: 402,
      },
      { tool: 'get_plan_logs', args: { run_id: runId }, output: log, durationMs: 456 },
    ],
    triage: {
      failureClass: {
        choice: 'provider_version',
        confidence: 0.81,
        probabilities: { provider_version: 0.81, module_source: 0.09, config_syntax: 0.06, unknown: 0.04 },
      },
      configFixable: { noul: 0.64 },
      blastRadius: {
        score: 0.55,
        confidence: 0.62,
        probabilities: { '0': 0.31, '1': 0.42, '2': 0.21, '3': 0.06 },
        legend: {
          '0': 'Nothing is destroyed or replaced',
          '1': 'Only stateless resources',
          '2': 'Stateful',
          '3': 'Data-bearing',
        },
      },
      needsHuman: { noul: 0.72 },
      stage: 'init',
      errorExcerpt: errorExcerpt(log),
      provider: 'jev',
      inputTokens: 1_720,
      latencyMs: 951,
    },
    jevRequest: JEV_REQUEST,
    config: {
      task: 'Find the conflicting version constraints for hashicorp/random.',
      tools: [
        { tool: 'read_file', args: { path: 'versions.tf' }, output: before, durationMs: 33 },
        {
          tool: 'get_latest_provider_version',
          args: { namespace: 'hashicorp', name: 'random' },
          output: '3.7.2',
          durationMs: 610,
        },
      ],
      diagnosis: {
        rootCause: 'versions.tf pins hashicorp/random to ~> 2.0 while a module requires >= 3.6.0.',
        evidence: [{ kind: 'file', ref: 'versions.tf:5', excerpt: 'version = "~> 2.0"' }],
        suggestedChange: 'Raise the root constraint to ~> 3.6.',
        confidence: 0.79,
      },
      usage: { inputTokens: 11_300, outputTokens: 820 },
    },
    reality: {
      task: 'Check which random_* resources a major provider upgrade would touch.',
      tools: [
        {
          tool: 'get_state_version',
          args: { serial: 41 },
          output: { resources: ['random_pet.service', 'random_id.release'] },
          durationMs: 488,
        },
      ],
      diagnosis: {
        rootCause: 'Two random_* resources are in state; a 2.x to 3.x upgrade may plan replacements.',
        evidence: [{ kind: 'state', ref: 'state v41', excerpt: 'random_pet.service, random_id.release' }],
        suggestedChange: 'Have a human review the major upgrade.',
        confidence: 0.7,
      },
      usage: { inputTokens: 8_900, outputTokens: 560 },
    },
    patch: {
      title: 'Raise the random provider constraint to 3.6',
      summary: 'Init fails because the root and module constraints for hashicorp/random cannot both be met.',
      files: [
        {
          path: 'versions.tf',
          before,
          after,
          rationale:
            'Aligns the root constraint with the module requirement. This is a major provider upgrade, so it is a draft for review.',
        },
      ],
    },
    fixUsage: { inputTokens: 9_400, outputTokens: 610 },
    verify: {
      ok: true,
      summary: 'Speculative plan passed with no replacements. Opened as a draft because versions.tf changed.',
      fmt: ok('', 405),
      validate: ok('Success! The configuration is valid.', 2_310),
      plan: ok('No changes. Your infrastructure matches the configuration.', 21_700),
    },
    pr: {
      number: 14,
      url: 'https://github.com/tayden-b/rerun-fixtures/pull/14',
      branch: `rerun/fix-${runId}`,
      draft: true,
    },
  };
}

type EventInput = Omit<IncidentEvent, 'incidentId' | 'seq' | 'at'> & { atMs: number };

/** Turns a scenario into the event stream the incident workflow writes (SPEC §2 steps, §6 kinds). */
export function buildEvents(s: Scenario, startMs: number): EventInput[] {
  const events: EventInput[] = [];
  let t = startMs;
  const push = (e: Omit<EventInput, 'atMs'>, advanceMs = 0) => {
    t += advanceMs;
    events.push({ ...e, atMs: t });
  };
  const status = (step: string, value: IncidentStatus) =>
    push({ step, kind: 'status', title: value, payload: { status: value } }, 200);
  const tools = (step: string, prefix: string, list: ToolStep[]) =>
    list.forEach((tool, index) => {
      const toolCallId = `${prefix}-${index + 1}`;
      push(
        {
          step,
          kind: 'tool_call',
          title: tool.tool,
          payload: { toolCallId, tool: tool.tool, args: tool.args },
        },
        120,
      );
      push(
        {
          step,
          kind: 'tool_result',
          title: tool.tool,
          payload: {
            toolCallId,
            tool: tool.tool,
            ok: tool.ok ?? true,
            output: tool.output,
            durationMs: tool.durationMs,
          },
        },
        tool.durationMs,
      );
    });

  status('collect', 'collecting');
  tools('collect', 'collect', s.collect);

  status('triage', 'triaging');
  push({ step: 'triage', kind: 'decision', title: 'Jev triage', payload: s.triage }, s.triage.latencyMs);

  status('diagnose', 'diagnosing');
  let diagnoseEnd = t;
  for (const agent of ['config', 'reality'] as const) {
    const script = s[agent];
    const step = `diagnose:${agent}`;
    const agentStart = t;
    push({
      step,
      kind: 'agent_step',
      title: `${agent === 'config' ? 'Config' : 'Reality'} agent started`,
      payload: { agent, model: AGENT_MODEL, task: script.task },
    });
    tools(step, agent, script.tools);
    push(
      {
        step,
        kind: 'artifact',
        title: 'Diagnosis',
        payload: {
          agent,
          steps: script.tools.length + 1,
          ...script.diagnosis,
          usage: { model: AGENT_MODEL, ...script.usage },
        },
      },
      4_200,
    );
    diagnoseEnd = Math.max(diagnoseEnd, t);
    if (agent === 'config') t = agentStart + 300;
  }
  t = diagnoseEnd;

  status('fix', 'fixing');
  push({ step: 'fix', kind: 'agent_step', title: 'Fix agent started', payload: { model: AGENT_MODEL } });
  push(
    {
      step: 'fix',
      kind: 'artifact',
      title: s.patch.title,
      payload: { ...s.patch, usage: { model: AGENT_MODEL, ...s.fixUsage } },
    },
    9_800,
  );

  status('verify', 'verifying');
  push(
    { step: 'verify', kind: 'artifact', title: s.verify.summary, payload: s.verify },
    s.verify.fmt.durationMs + s.verify.validate.durationMs + s.verify.plan.durationMs,
  );

  status('propose', 'proposing');
  push({ step: 'propose', kind: 'artifact', title: `PR #${s.pr.number}`, payload: s.pr }, 2_600);

  if (s.finalStatus === 'needs_human') {
    push(
      {
        step: 'propose',
        kind: 'status',
        title: 'needs_human',
        payload: { status: 'needs_human', draft: true },
      },
      200,
    );
    return events;
  }
  status('await', 'awaiting_approval');
  if (s.finalStatus === 'awaiting_approval') return events;

  push(
    {
      step: 'await',
      kind: 'status',
      title: 'merged',
      payload: { status: 'merged', approvedBy: 'dashboard' },
    },
    6 * MINUTE,
  );
  status('confirm', 'confirming');
  if (s.confirm) {
    tools('confirm', 'confirm', [
      {
        tool: 'get_run_details',
        args: { run_id: s.confirm.runId },
        output: { id: s.confirm.runId, status: s.confirm.status },
        durationMs: 95_000,
      },
    ]);
  }
  push({ step: 'confirm', kind: 'status', title: 'resolved', payload: { status: 'resolved' } }, 300);
  return events;
}

/** Replaces the three demo incidents in `db`; timestamps are relative to now so ages read naturally. */
export async function seedDemo(db: Db, now: number = Date.now()): Promise<number> {
  const scenarios = [unsetVariable(), providerVersionConflict(), applyTimeExit1()];
  const ids = scenarios.map((s) => s.id);
  await db.delete(schema.incidentEvents).where(inArray(schema.incidentEvents.incidentId, ids));
  await db.delete(schema.decisions).where(inArray(schema.decisions.incidentId, ids));
  await db.delete(schema.artifacts).where(inArray(schema.artifacts.incidentId, ids));
  await db.delete(schema.incidents).where(inArray(schema.incidents.id, ids));

  for (const s of scenarios) {
    const startMs = now - s.minutesAgo * MINUTE;
    const createdAt = new Date(startMs).toISOString();
    await createIncident(db, { id: s.id, runId: s.runId, workspace: s.workspace, createdAt });
    const events = buildEvents(s, startMs);
    for (const { atMs, ...event } of events) {
      await appendEvent(db, s.id, { ...event, at: new Date(atMs).toISOString() });
    }
    await addDecision(db, s.id, {
      provider: 'jev',
      request: s.jevRequest,
      response: s.triage,
      inputTokens: s.triage.inputTokens,
      latencyMs: s.triage.latencyMs,
      at: new Date(startMs + 2_000).toISOString(),
    });
    for (const file of s.patch.files) {
      await addArtifact(db, s.id, { type: 'diff', name: file.path, content: file.after });
    }
    await addArtifact(db, s.id, { type: 'verify_output', name: 'plan', content: s.verify.plan.stdout });
    const lastAt = new Date(events.at(-1)!.atMs).toISOString();
    await setStatus(db, s.id, s.finalStatus, {
      failureClass: s.failureClass,
      stage: s.stage,
      route: s.route,
      prUrl: s.pr.url,
      prNumber: s.pr.number,
      needsHuman: s.finalStatus === 'needs_human',
      costUsd: s.costUsd,
      ...(s.finalStatus === 'resolved' ? { resolvedAt: lastAt } : {}),
    });
  }
  return scenarios.length;
}

async function main(): Promise<void> {
  await import('./load-env');
  const { config } = await import('../src/config');
  const { getDb } = await import('../src/db');
  const count = await seedDemo(await getDb());
  console.log(`seed:demo: ${count} incidents in ${config.databaseUrl}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
