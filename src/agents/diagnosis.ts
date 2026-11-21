import { Output, ToolLoopAgent, stepCountIs, type ToolSet } from 'ai';
import { z } from 'zod';
import type { Diagnosis, IncidentContext } from '../shared/types';
import {
  emitDone,
  emitStep,
  finalStepWithoutTools,
  incidentBrief,
  modelIdOf,
  toUsage,
  type AgentDeps,
  type AgentStepName,
} from './runtime';
import type { Workdir } from './workdir';

export const evidenceSchema = z.object({
  kind: z.enum(['log', 'plan', 'state', 'file', 'docs']),
  ref: z.string().describe('file "<path>:<line>", log "plan:<line>"/"apply:<line>", or a resource address'),
  excerpt: z.string().describe('The exact lines relied on, short'),
});

/** The model's part of a Diagnosis; `agent` and `steps` are filled in by the runner. */
export const diagnosisOutputSchema = z.object({
  rootCause: z.string(),
  evidence: z.array(evidenceSchema),
  suggestedChange: z.string(),
  confidence: z.number().describe('0 to 1'),
});

export type DiagnosisAgentName = Diagnosis['agent'];

export interface DiagnosisAgentSpec {
  name: DiagnosisAgentName;
  instructions: string;
  maxSteps: number;
  tools: (ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) => ToolSet;
}

export const stepNameOf = (agent: DiagnosisAgentName): AgentStepName => `diagnose:${agent}`;

export function createDiagnosisAgent(
  spec: DiagnosisAgentSpec,
  ctx: IncidentContext,
  workdir: Workdir,
  deps: AgentDeps,
) {
  return new ToolLoopAgent({
    id: `rerun-${spec.name}`,
    model: deps.model,
    instructions: spec.instructions,
    tools: spec.tools(ctx, workdir, deps),
    output: Output.object({ schema: diagnosisOutputSchema, name: 'diagnosis' }),
    stopWhen: stepCountIs(spec.maxSteps),
    prepareStep: finalStepWithoutTools(spec.maxSteps),
    experimental_telemetry: {
      isEnabled: true,
      functionId: `rerun.diagnose.${spec.name}`,
      metadata: { incidentId: ctx.incidentId, runId: ctx.runId },
    },
  });
}

const FILE_BLAME_CONFIDENCE_CAP = 0.5;

/** A diagnosis that names a repo file without a `file` evidence ref is not trusted above 0.5. */
export function finalizeDiagnosis(
  agent: DiagnosisAgentName,
  output: z.infer<typeof diagnosisOutputSchema>,
  steps: number,
  repoFiles: string[],
): Diagnosis {
  let confidence = Math.max(0, Math.min(1, Number.isFinite(output.confidence) ? output.confidence : 0));
  const blamesFile = repoFiles.some((file) => output.rootCause.includes(file));
  if (blamesFile && !output.evidence.some((e) => e.kind === 'file')) {
    confidence = Math.min(confidence, FILE_BLAME_CONFIDENCE_CAP);
  }
  return {
    agent,
    rootCause: output.rootCause,
    evidence: output.evidence,
    suggestedChange: output.suggestedChange,
    confidence,
    steps,
  };
}

export async function runDiagnosisAgent(
  spec: DiagnosisAgentSpec,
  ctx: IncidentContext,
  workdir: Workdir,
  deps: AgentDeps,
): Promise<Diagnosis> {
  const step = stepNameOf(spec.name);
  const agent = createDiagnosisAgent(spec, ctx, workdir, deps);
  const result = await agent.generate({
    prompt: incidentBrief(ctx, workdir),
    onStepFinish: (s) => emitStep(deps, ctx.incidentId, step, s),
  });
  await emitDone(
    deps,
    ctx.incidentId,
    step,
    result.steps.length,
    toUsage(result.totalUsage),
    modelIdOf(deps.model),
  );
  return finalizeDiagnosis(spec.name, result.output, result.steps.length, workdir.list());
}
