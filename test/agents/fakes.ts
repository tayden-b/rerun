import { tool, type ToolSet } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import type { AgentDeps, AgentEvent } from '../../src/agents/runtime';
import type { FailureClass, IncidentContext, TriageResult } from '../../src/shared/types';

// Local stand-ins for W1-A's MCP client (`mcp.tools()`) and W1-B's triage, coded against SPEC §11.

export const UNDECLARED_REFERENCE_FILES: Record<string, string> = {
  'main.tf': [
    'resource "random_pet" "service" {',
    '  length    = 2',
    '  separator = "-"',
    '}',
    '',
    'resource "terraform_data" "bootstrap" {',
    '  input = var.environment',
    '}',
    '',
  ].join('\n'),
  'variables.tf': [
    'variable "environment" {',
    '  type    = string',
    '  default = "rerun-fixtures"',
    '}',
    '',
  ].join('\n'),
  'outputs.tf': [
    'output "service_name" {',
    '  value = random_pet.service.id',
    '}',
    '',
    'output "service_url" {',
    '  value = "https://${random_pet.servce.id}.example.internal"',
    '}',
    '',
  ].join('\n'),
};

export const UNDECLARED_REFERENCE_PLAN_LOG = [
  'Terraform v1.14.3',
  'on linux_amd64',
  'Initializing plugins and modules...',
  '╷',
  '│ Error: Reference to undeclared resource',
  '│',
  '│   on outputs.tf line 6, in output "service_url":',
  '│    6:   value = "https://${random_pet.servce.id}.example.internal"',
  '│',
  '│ A managed resource "random_pet" "servce" has not been declared in the root',
  '│ module.',
  '╵',
  'Operation failed: failed running terraform plan (exit 1)',
].join('\n');

export function fakeTriage(
  failureClass: FailureClass = 'config_reference',
  stage: TriageResult['stage'] = 'plan',
) {
  return {
    failureClass: { choice: failureClass, confidence: 0.93, probabilities: { [failureClass]: 0.93 } },
    configFixable: { noul: 0.91 },
    blastRadius: {
      score: 0,
      confidence: 0.9,
      probabilities: { '0': 0.9 },
      legend: { '0': 'Nothing is destroyed' },
    },
    needsHuman: { noul: 0.1 },
    stage,
    errorExcerpt: UNDECLARED_REFERENCE_PLAN_LOG,
    provider: 'recorded',
    inputTokens: 0,
    latencyMs: 0,
  } satisfies TriageResult;
}

export function fakeContext(overrides: Partial<IncidentContext> = {}): IncidentContext {
  return {
    incidentId: 'inc-test-1',
    runId: 'run-TestRun0001',
    workspace: 'rerun-fixtures',
    artifacts: {
      run: { id: 'run-TestRun0001', status: 'errored' },
      workspace: { name: 'rerun-fixtures' },
      planLogs: UNDECLARED_REFERENCE_PLAN_LOG,
      stage: 'plan',
      errorExcerpt: UNDECLARED_REFERENCE_PLAN_LOG,
    },
    triage: fakeTriage(),
    repo: { owner: 'tayden-b', name: 'rerun-fixtures', baseBranch: 'main', headSha: 'abc1234' },
    ...overrides,
  };
}

/** Shape of `mcp.tools()` for the two registry tools the agents pass through. */
export function fakeMcpTools(calls: string[] = []): ToolSet {
  return {
    search_provider_docs: tool({
      description: 'Search Terraform provider docs (fake)',
      inputSchema: z.object({ provider_name: z.string(), service_slug: z.string() }),
      execute: async (input) => {
        calls.push(`search_provider_docs:${JSON.stringify(input)}`);
        return { content: [{ type: 'text', text: `docs for ${input.provider_name}/${input.service_slug}` }] };
      },
    }),
    get_provider_details: tool({
      description: 'Get provider doc details (fake)',
      inputSchema: z.object({ provider_doc_id: z.string() }),
      execute: async ({ provider_doc_id }) => `details ${provider_doc_id}`,
    }),
    get_run_details: tool({
      description: 'Not passed through to agents',
      inputSchema: z.object({}),
      execute: async () => 'run',
    }),
  };
}

export function recordingEmit() {
  const events: AgentEvent[] = [];
  return { events, emit: (event: AgentEvent) => void events.push(event) };
}

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;
type CallOptions = Parameters<MockLanguageModelV3['doGenerate']>[0];

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

let callSeq = 0;

export function toolCalls(...calls: Array<{ toolName: string; input: unknown }>): GenerateResult {
  return {
    content: calls.map((c) => ({
      type: 'tool-call' as const,
      toolCallId: `call-${++callSeq}`,
      toolName: c.toolName,
      input: JSON.stringify(c.input),
    })),
    finishReason: { unified: 'tool-calls', raw: 'tool_use' },
    usage,
    warnings: [],
  };
}

export function answer(value: unknown): GenerateResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage,
    warnings: [],
  };
}

export type Script = GenerateResult[] | (() => never);

const systemText = (options: CallOptions) =>
  options.prompt.map((m) => (m.role === 'system' ? m.content : '')).join('\n');

/**
 * A mock model that plays a separate script per agent, picked by the agent's instructions
 * ("Rerun's Config agent" etc.), so parallel agents can share one model.
 */
export function scriptedModel(scripts: Partial<Record<'Config' | 'Reality' | 'Fix', Script>>) {
  const cursor: Record<string, number> = {};
  const seen: CallOptions[] = [];
  const model = new MockLanguageModelV3({
    modelId: 'mock-agent-model',
    doGenerate: async (options) => {
      seen.push(options);
      const system = systemText(options);
      const name = (['Config', 'Reality', 'Fix'] as const).find((n) => system.includes(`Rerun's ${n} agent`));
      const script = name ? scripts[name] : undefined;
      if (!name || !script) throw new Error(`no script for agent ${name ?? '(unknown)'}`);
      if (typeof script === 'function') return script();
      const i = cursor[name] ?? 0;
      cursor[name] = i + 1;
      const next = script[i];
      if (!next) throw new Error(`script for ${name} exhausted after ${i} calls`);
      return next;
    },
  });
  return { model, seen };
}

export interface FakeDeps extends AgentDeps {
  events: AgentEvent[];
}

export function fakeDeps({
  model,
  files,
}: {
  model: AgentDeps['model'];
  files?: Record<string, string>;
}): FakeDeps {
  const { events, emit } = recordingEmit();
  const deps: FakeDeps = {
    model,
    files: files ?? UNDECLARED_REFERENCE_FILES,
    mcpTools: fakeMcpTools(),
    emit,
    events,
  };
  return deps;
}
