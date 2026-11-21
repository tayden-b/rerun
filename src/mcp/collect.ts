import { extractErrorExcerpt } from '../shared/excerpt';
import { redact } from '../shared/redact';
import type { IncidentEvent, RunArtifacts, Stage } from '../shared/types';
import { attribute, dig, isRecord, relationshipId, renderTerraformLog } from './parse';
import type { TerraformMcp, ToolObserverEvent, ToolResult } from './terraform';

/** What `collectRunArtifacts` emits; the caller adds `incidentId`/`seq` (e.g. `appendEvent`). */
export type CollectEvent = Pick<IncidentEvent, 'step' | 'kind' | 'title' | 'payload'> & { at: string };
export type EmitFn = (event: CollectEvent) => void | Promise<void>;

/** Phase statuses meaning the phase never started, so its logs/JSON do not exist. */
const NOT_STARTED = new Set(['pending', 'queued', 'unreachable', 'canceled', 'discarded']);
const FAILED_PHASE = /failed running terraform (init|plan|apply)\b/;
const PAYLOAD_PREVIEW = 4000;

export interface StageInput {
  run: unknown;
  planStatus?: string;
  applyStatus?: string;
  planLog?: string;
  applyLog?: string;
}

/**
 * Stage rule, derived from real HCP Terraform runs on `rerun-fixtures`:
 * 1. The HCP worker's closing line `Operation failed: failed running terraform <init|plan|apply>` names
 *    the failing command; the apply log is checked before the plan log. Module/provider install errors end
 *    in `... terraform init` inside the plan phase (plan status `errored`), so this is what separates
 *    `init` from `plan`.
 * 2. Otherwise: apply status `errored` → `apply`; plan status `errored` → `plan`.
 * 3. Otherwise: the run reached `applying-at` → `apply`, else `plan`.
 * Note: every run has an apply relationship; a run that failed before applying has apply status `unreachable`.
 */
export function determineStage(input: StageInput): Stage {
  for (const log of [input.applyLog, input.planLog]) {
    const match = log ? FAILED_PHASE.exec(log) : null;
    if (match) return match[1] as Stage;
  }
  if (input.applyStatus === 'errored') return 'apply';
  if (input.planStatus === 'errored') return 'plan';
  return dig(attribute(input.run, 'status-timestamps'), 'applying-at') ? 'apply' : 'plan';
}

/** Event payloads stay small: short results inline (redacted), long ones as a truncated preview. */
function preview(result: ToolResult): unknown {
  const text = redact(result.text);
  if (text.length > PAYLOAD_PREVIEW) {
    return { truncated: true, bytes: result.text.length, preview: text.slice(0, PAYLOAD_PREVIEW) };
  }
  const isText = isRecord(result.data) && typeof result.data.text === 'string';
  return isText ? text : (JSON.parse(text) as unknown);
}

function toEvent(e: ToolObserverEvent): CollectEvent {
  const at = new Date().toISOString();
  if (e.phase === 'call')
    return { at, step: 'collect', kind: 'tool_call', title: e.tool, payload: { tool: e.tool, args: e.args } };
  if (e.phase === 'result') {
    return {
      at,
      step: 'collect',
      kind: 'tool_result',
      title: e.tool,
      payload: { tool: e.tool, durationMs: e.durationMs, result: preview(e.result) },
    };
  }
  return {
    at,
    step: 'collect',
    kind: 'error',
    title: e.tool,
    payload: { tool: e.tool, durationMs: e.durationMs, error: redact(e.error.message) },
  };
}

function status(result: ToolResult | undefined): string | undefined {
  const s = attribute(result?.data, 'status');
  return typeof s === 'string' ? s : undefined;
}

/** Plain log text: a text result is the log itself; JSON results are not logs. */
function logText(result: ToolResult): string {
  return isRecord(result.data) && typeof result.data.text === 'string' ? result.data.text : result.text;
}

/** SPEC §2 step 1. Every MCP call is emitted as `tool_call` then `tool_result` (or `error`), in order. */
export async function collectRunArtifacts(
  mcp: TerraformMcp,
  runId: string,
  emit: EmitFn = () => {},
): Promise<RunArtifacts> {
  // Emits are chained so an async sink (e.g. `appendEvent`) stores them in call order.
  let chain: Promise<void> = Promise.resolve();
  const traced = mcp.withObserver((e) => {
    const event = toEvent(e);
    chain = chain.then(() => emit(event));
  });
  const optional = async (fn: () => Promise<ToolResult>) => {
    try {
      return await fn();
    } catch {
      return undefined;
    }
  };

  try {
    const workspace = await traced.getWorkspaceDetails();
    const run = await traced.getRunDetails(runId);
    const planId = relationshipId(run.data, 'plan');
    const applyId = relationshipId(run.data, 'apply');

    let planStatus: string | undefined;
    let planLogs: string | undefined;
    let planJson: unknown;
    if (planId) {
      planStatus = status(await traced.getPlanDetails(planId));
      if (planStatus && !NOT_STARTED.has(planStatus)) {
        const logs = await optional(() => traced.getPlanLogs(planId));
        if (logs) planLogs = renderTerraformLog(logText(logs));
      }
      if (planStatus === 'finished') {
        const json = await optional(() => traced.getPlanJsonOutput(planId));
        if (json && json.text.trim()) planJson = json.data;
      }
    }

    let applyStatus: string | undefined;
    let applyLogs: string | undefined;
    if (applyId) {
      applyStatus = status(await traced.getApplyDetails(applyId));
      if (applyStatus && !NOT_STARTED.has(applyStatus)) {
        const logs = await optional(() => traced.getApplyLogs(applyId));
        if (logs) applyLogs = renderTerraformLog(logText(logs));
      }
    }

    const stateVersion = (await optional(() => traced.getStateVersion()))?.data;
    const stage = determineStage({
      run: run.data,
      planStatus,
      applyStatus,
      planLog: planLogs,
      applyLog: applyLogs,
    });
    const failingLog = (stage === 'apply' ? applyLogs : planLogs) ?? applyLogs ?? planLogs ?? '';
    const errorExcerpt = extractErrorExcerpt(failingLog);

    return {
      run: run.data,
      workspace: workspace.data,
      planLogs,
      planJson,
      applyLogs,
      stateVersion,
      stage,
      errorExcerpt,
    };
  } finally {
    await chain;
  }
}
