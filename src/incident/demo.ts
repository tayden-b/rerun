import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MockLanguageModelV3 } from 'ai/test';
import { config } from '../config';
import { DEMO_BASELINE_FILES } from '../github/demoBaseline';
import type { RunSummary } from '../watch/runs';

// Demo mode (SPEC §1): every external system is replaced by a recording. The agents replay a scripted
// transcript per scenario from `fixtures/scenarios/<name>/agents.json`, and the fake GitHub repo starts
// from the rerun-fixtures baseline with the scenario's break applied (`repo` edits in the same file).

export const SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');
/** The configured agent model, marked as a replay so the transcript is never mistaken for a live call. */
export const DEMO_AGENT_MODEL_ID = `${config.models.agent} · replay`;

type AgentKey = 'config' | 'reality' | 'fix';

export interface ScriptedStep {
  /** Tool calls the model makes in this step. */
  toolCalls?: { toolName: string; input: Record<string, unknown>; durationMs?: number }[];
  /** The structured final answer (diagnosis or fix title/summary). */
  output?: Record<string, unknown>;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AgentTranscript {
  /** Edits that turn the baseline into the scenario's broken `main`. */
  repo: { path: string; oldText: string; newText: string }[];
  agents: Partial<Record<AgentKey, ScriptedStep[]>>;
}

const scenarioNames = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

/** The recorded scenario whose `get_run_details` fixture is `runId`. */
export function scenarioForRun(runId: string, dir: string = SCENARIOS_DIR): string | undefined {
  for (const name of scenarioNames(dir)) {
    const file = path.join(dir, name, 'mcp', 'get_run_details.json');
    if (!existsSync(file)) continue;
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as { args?: { run_id?: string } };
    if (fixture.args?.run_id === runId) return name;
  }
  return undefined;
}

export function runIdForScenario(scenario: string, dir: string = SCENARIOS_DIR): string {
  const file = path.join(dir, scenario, 'mcp', 'get_run_details.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { args: { run_id: string } }).args.run_id;
}

export function loadTranscript(scenario: string, dir: string = SCENARIOS_DIR): AgentTranscript {
  const file = path.join(dir, scenario, 'agents.json');
  if (!existsSync(file)) return { repo: [], agents: {} };
  return JSON.parse(readFileSync(file, 'utf8')) as AgentTranscript;
}

/** The rerun-fixtures baseline with the scenario's break applied. */
export function demoRepoFiles(transcript: AgentTranscript): Record<string, string> {
  const files = { ...DEMO_BASELINE_FILES };
  for (const edit of transcript.repo) {
    const before = files[edit.path];
    if (before === undefined || before.split(edit.oldText).length !== 2) {
      throw new Error(`agents.json repo edit does not apply exactly once to ${edit.path}`);
    }
    files[edit.path] = before.replace(edit.oldText, () => edit.newText);
  }
  return files;
}

const toolCallId = (agent: AgentKey, step: number, call: number) => `${agent}-${step + 1}-${call + 1}`;

/** Simulated tool durations from the transcript, keyed by the tool call ids the scripted model emits. */
export function transcriptToolDurations(transcript: AgentTranscript): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [agent, steps] of Object.entries(transcript.agents) as [AgentKey, ScriptedStep[]][]) {
    steps.forEach((step, s) =>
      step.toolCalls?.forEach((call, c) => {
        if (typeof call.durationMs === 'number') durations.set(toolCallId(agent, s, c), call.durationMs);
      }),
    );
  }
  return durations;
}

type CallOptions = Parameters<MockLanguageModelV3['doGenerate']>[0];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>;

const AGENT_MARKERS: [AgentKey, string][] = [
  ['config', "Rerun's Config agent"],
  ['reality', "Rerun's Reality agent"],
  ['fix', "Rerun's Fix agent"],
];

function agentOf(options: CallOptions): AgentKey | undefined {
  const system = options.prompt.map((m) => (m.role === 'system' ? m.content : '')).join('\n');
  return AGENT_MARKERS.find(([, marker]) => system.includes(marker))?.[0];
}

const DEFAULT_USAGE = { inputTokens: 1800, outputTokens: 160 };

function toResult(agent: AgentKey, index: number, step: ScriptedStep): GenerateResult {
  const u = step.usage ?? DEFAULT_USAGE;
  const usage = {
    inputTokens: { total: u.inputTokens, noCache: u.inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: u.outputTokens, text: u.outputTokens, reasoning: 0 },
  };
  if (step.toolCalls?.length) {
    return {
      content: step.toolCalls.map((call, i) => ({
        type: 'tool-call' as const,
        toolCallId: toolCallId(agent, index, i),
        toolName: call.toolName,
        input: JSON.stringify(call.input),
      })),
      finishReason: { unified: 'tool-calls', raw: 'tool_use' },
      usage,
      warnings: [],
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(step.output ?? {}) }],
    finishReason: { unified: 'stop', raw: 'end_turn' },
    usage,
    warnings: [],
  };
}

/** Simulated model latency for one turn: a fixed overhead plus roughly 125 output tokens per second. */
const turnLatencyMs = (step: ScriptedStep) => 350 + (step.usage?.outputTokens ?? 80) * 8;

/**
 * A mock model (`ai/test`) that replays the transcript. The agent is recognised from its system prompt
 * and the step from the number of assistant turns so far, so one instance serves parallel agents and
 * the fix retry without shared state.
 */
export function scriptedAgentModel(
  transcript: AgentTranscript,
  opts: { pace?: boolean } = {},
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    provider: 'rerun-demo',
    modelId: DEMO_AGENT_MODEL_ID,
    doGenerate: async (options) => {
      const agent = agentOf(options);
      const script = agent ? transcript.agents[agent] : undefined;
      if (!agent || !script?.length) throw new Error(`No demo transcript for agent ${agent ?? '(unknown)'}`);
      const index = options.prompt.filter((m) => m.role === 'assistant').length;
      const step = script[Math.min(index, script.length - 1)];
      if (opts.pace) await new Promise((resolve) => setTimeout(resolve, turnLatencyMs(step)));
      return toResult(agent, index, step);
    },
  });
}

/**
 * Demo stand-in for the run the merge triggers: fake GitHub has no Actions, so after a merge the
 * next run on the workspace is an `applied` run created now. Later recorded runs are hidden so the
 * watcher sees this run as the next one.
 */
export function demoNextRuns(runs: RunSummary[], afterRunId: string, now: Date): RunSummary[] {
  const anchor = runs.find((r) => r.id === afterRunId);
  const earlier = anchor ? runs.filter((r) => Date.parse(r.createdAt) <= Date.parse(anchor.createdAt)) : runs;
  return [{ id: `${afterRunId}-next`, status: 'applied', createdAt: now.toISOString() }, ...earlier];
}
