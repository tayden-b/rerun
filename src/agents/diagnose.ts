import type { Diagnosis, FailureClass, IncidentContext } from '../shared/types';
import { redact } from '../shared/redact';
import { CONFIG_AGENT } from './config';
import { runDiagnosisAgent, stepNameOf, type DiagnosisAgentName } from './diagnosis';
import { REALITY_AGENT } from './reality';
import type { AgentDeps } from './runtime';
import { materializeRepo } from './workdir';

const SPECS = { config: CONFIG_AGENT, reality: REALITY_AGENT } as const;

const REALITY_CLASSES: FailureClass[] = ['drift', 'apply_runtime', 'provider_api_error', 'unknown'];

/** SPEC §4: Config always runs; Reality runs for apply-stage failures and the runtime-ish classes. */
export function selectAgents(ctx: IncidentContext): DiagnosisAgentName[] {
  const failureClass = ctx.triage?.failureClass.choice ?? 'unknown';
  const stage = ctx.triage?.stage ?? ctx.artifacts.stage;
  return stage === 'apply' || REALITY_CLASSES.includes(failureClass) ? ['config', 'reality'] : ['config'];
}

const errorMessage = (error: unknown) => redact(error instanceof Error ? error.message : String(error));

/**
 * Runs the selected diagnosis agents in parallel over one shared read-only working copy.
 * A failed agent becomes a confidence-0 Diagnosis carrying the error, so the incident continues.
 */
export async function runDiagnosis(
  ctx: IncidentContext,
  which: DiagnosisAgentName[],
  deps: AgentDeps,
): Promise<Diagnosis[]> {
  const agents = [...new Set(which)];
  const workdir = await materializeRepo({ files: deps.files });
  try {
    const settled = await Promise.allSettled(
      agents.map((name) => runDiagnosisAgent(SPECS[name], ctx, workdir, deps)),
    );
    const out: Diagnosis[] = [];
    for (const [i, result] of settled.entries()) {
      const agent = agents[i];
      if (result.status === 'fulfilled') {
        out.push(result.value);
        continue;
      }
      const message = errorMessage(result.reason);
      await deps.emit({
        incidentId: ctx.incidentId,
        step: stepNameOf(agent),
        kind: 'error',
        title: `${agent} agent failed`,
        payload: { error: message },
      });
      out.push({
        agent,
        rootCause: `The ${agent} agent failed: ${message}`,
        evidence: [],
        suggestedChange: '',
        confidence: 0,
        steps: 0,
      });
    }
    return out;
  } finally {
    await workdir.cleanup();
  }
}
