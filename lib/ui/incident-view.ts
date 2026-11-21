import type { IncidentDetail } from '@/src/db/incidents';
import type {
  Diagnosis,
  IncidentEvent,
  IncidentStatus,
  Patch,
  PullRequest,
  TriageResult,
  VerifyResult,
} from '@/src/shared/types';

/** SPEC §2 steps in pipeline order; `diagnose` groups `diagnose:config` and `diagnose:reality`. */
export const PIPELINE_STEPS = [
  'collect',
  'triage',
  'diagnose',
  'fix',
  'verify',
  'propose',
  'await',
  'confirm',
] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const STEP_LABELS: Record<PipelineStep, string> = {
  collect: 'Collected run data',
  triage: 'Triaged with Jev',
  diagnose: 'Diagnosed',
  fix: 'Wrote fix',
  verify: 'Verified fix',
  propose: 'Opened pull request',
  await: 'Awaiting approval',
  confirm: 'Confirmed next run',
};

const RUNNING_STEP: Partial<Record<IncidentStatus, PipelineStep>> = {
  collecting: 'collect',
  triaging: 'triage',
  diagnosing: 'diagnose',
  fixing: 'fix',
  verifying: 'verify',
  proposing: 'propose',
  awaiting_approval: 'await',
  merged: 'confirm',
  confirming: 'confirm',
};

export type StepState = 'done' | 'running' | 'error' | 'pending';

export interface StepView {
  step: PipelineStep;
  label: string;
  state: StepState;
  durationMs: number | null;
  events: IncidentEvent[];
}

export interface ToolCallView {
  id: string;
  tool: string;
  args: unknown;
  output?: unknown;
  ok?: boolean;
  durationMs?: number;
}

export interface SubagentView {
  agent: 'config' | 'reality';
  state: StepState;
  model?: string;
  task?: string;
  tools: ToolCallView[];
  diagnosis?: Diagnosis;
  durationMs: number | null;
}

export interface UsageRow {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface IncidentView {
  title: string;
  triage?: TriageResult;
  subagents: SubagentView[];
  patch?: Patch;
  verify?: VerifyResult;
  pr?: PullRequest;
  steps: StepView[];
  usage: UsageRow[];
  jevTokens: number;
  totalDurationMs: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stepOf(event: IncidentEvent): PipelineStep | null {
  const base = event.step.split(':')[0];
  return (PIPELINE_STEPS as readonly string[]).includes(base) ? (base as PipelineStep) : null;
}

function span(events: IncidentEvent[]): number | null {
  if (events.length === 0) return null;
  const times = events.map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  return Math.max(...times) - Math.min(...times);
}

function isTriage(payload: unknown): payload is TriageResult {
  return isObject(payload) && isObject(payload.failureClass) && isObject(payload.configFixable);
}
function isPatch(payload: unknown): payload is Patch {
  return isObject(payload) && Array.isArray(payload.files);
}
function isVerify(payload: unknown): payload is VerifyResult {
  return isObject(payload) && isObject(payload.fmt) && isObject(payload.plan);
}
function isPullRequest(payload: unknown): payload is PullRequest {
  return isObject(payload) && typeof payload.url === 'string' && typeof payload.number === 'number';
}
function isDiagnosis(payload: unknown): payload is Diagnosis {
  return isObject(payload) && typeof payload.rootCause === 'string';
}

function lastPayload<T>(events: IncidentEvent[], guard: (p: unknown) => p is T): T | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (guard(events[i].payload)) return events[i].payload as T;
  }
  return undefined;
}

function buildSubagent(
  agent: 'config' | 'reality',
  events: IncidentEvent[],
  diagnoseState: StepState,
): SubagentView | null {
  const own = events.filter((e) => e.step === `diagnose:${agent}`);
  if (own.length === 0) return null;
  const tools = new Map<string, ToolCallView>();
  let model: string | undefined;
  let task: string | undefined;
  for (const event of own) {
    const p = isObject(event.payload) ? event.payload : {};
    if (event.kind === 'agent_step') {
      if (typeof p.model === 'string') model = p.model;
      if (typeof p.task === 'string') task = p.task;
    }
    if (event.kind === 'tool_call' || event.kind === 'tool_result') {
      const id = typeof p.toolCallId === 'string' ? p.toolCallId : `${event.title}-${event.seq}`;
      const tool = typeof p.tool === 'string' ? p.tool : event.title;
      const existing = tools.get(id) ?? { id, tool, args: undefined };
      if (event.kind === 'tool_call') existing.args = p.args;
      else {
        existing.output = p.output;
        existing.ok = p.ok !== false;
        if (typeof p.durationMs === 'number') existing.durationMs = p.durationMs;
      }
      tools.set(id, existing);
    }
  }
  const diagnosis = lastPayload(own, isDiagnosis);
  const failed = own.some((e) => e.kind === 'error');
  const state: StepState = diagnosis
    ? 'done'
    : failed
      ? 'error'
      : diagnoseState === 'running'
        ? 'running'
        : diagnoseState === 'pending'
          ? 'pending'
          : 'error';
  return { agent, state, model, task, tools: [...tools.values()], diagnosis, durationMs: span(own) };
}

function firstSentence(text: string): string {
  const match = text.match(/^(.+?[.!?])(\s|$)/);
  return (match ? match[1] : text).trim();
}

export function buildIncidentView(detail: IncidentDetail): IncidentView {
  const events = detail.events;
  const status = detail.status as IncidentStatus;
  const byStep = new Map<PipelineStep, IncidentEvent[]>();
  for (const event of events) {
    const step = stepOf(event);
    if (!step) continue;
    byStep.set(step, [...(byStep.get(step) ?? []), event]);
  }

  const running = RUNNING_STEP[status];
  const runningIndex = running ? PIPELINE_STEPS.indexOf(running) : -1;
  const lastWithEvents = Math.max(-1, ...PIPELINE_STEPS.map((s, i) => (byStep.has(s) ? i : -1)));

  const steps: StepView[] = PIPELINE_STEPS.map((step, index) => {
    const stepEvents = byStep.get(step) ?? [];
    let state: StepState;
    if (status === 'resolved') state = 'done';
    else if (stepEvents.at(-1)?.kind === 'error') state = 'error';
    else if (runningIndex >= 0)
      state = index < runningIndex ? 'done' : index === runningIndex ? 'running' : 'pending';
    else if (status === 'failed' && index === lastWithEvents) state = 'error';
    else state = stepEvents.length > 0 ? 'done' : 'pending';
    if (step === 'await' && status === 'awaiting_approval') state = 'running';

    let durationMs = span(stepEvents);
    const nextStart = events.find((e) => {
      const s = stepOf(e);
      return s !== null && PIPELINE_STEPS.indexOf(s) > index;
    });
    if (stepEvents.length > 0 && nextStart && state === 'done') {
      const start = Math.min(...stepEvents.map((e) => Date.parse(e.at)));
      durationMs = Math.max(durationMs ?? 0, Date.parse(nextStart.at) - start);
    }
    return { step, label: STEP_LABELS[step], state, durationMs, events: stepEvents };
  });

  const diagnoseState = steps.find((s) => s.step === 'diagnose')?.state ?? 'pending';
  const diagnoseEvents = byStep.get('diagnose') ?? [];
  const subagents = (['config', 'reality'] as const)
    .map((agent) => buildSubagent(agent, diagnoseEvents, diagnoseState))
    .filter((s): s is SubagentView => s !== null);

  const triage = lastPayload(byStep.get('triage') ?? [], isTriage);
  const patch = lastPayload(byStep.get('fix') ?? [], isPatch);
  const verify = lastPayload(byStep.get('verify') ?? [], isVerify);
  const pr = lastPayload(byStep.get('propose') ?? [], isPullRequest);

  const usageByModel = new Map<string, UsageRow>();
  for (const event of events) {
    const usage = isObject(event.payload) ? event.payload.usage : undefined;
    if (!isObject(usage) || typeof usage.model !== 'string') continue;
    const row = usageByModel.get(usage.model) ?? { model: usage.model, inputTokens: 0, outputTokens: 0 };
    row.inputTokens += Number(usage.inputTokens) || 0;
    row.outputTokens += Number(usage.outputTokens) || 0;
    usageByModel.set(usage.model, row);
  }
  const jevTokens =
    detail.decisions.filter((d) => d.provider === 'jev').reduce((sum, d) => sum + d.inputTokens, 0) ||
    (triage?.provider !== 'llm' ? (triage?.inputTokens ?? 0) : 0);

  const diagnosis = subagents.find((s) => s.diagnosis)?.diagnosis;
  const title = patch?.title
    ? patch.title
    : patch?.files[0]?.rationale
      ? firstSentence(patch.files[0].rationale)
      : diagnosis
        ? firstSentence(diagnosis.rootCause)
        : `Run ${detail.runId} failed`;

  const end = detail.resolvedAt
    ? Date.parse(detail.resolvedAt)
    : events.length
      ? Date.parse(events.at(-1)!.at)
      : NaN;
  const totalDurationMs = Number.isNaN(end) ? null : Math.max(0, end - Date.parse(detail.createdAt));

  return {
    title,
    triage,
    subagents,
    patch,
    verify,
    pr,
    steps,
    usage: [...usageByModel.values()],
    jevTokens,
    totalDurationMs,
  };
}
