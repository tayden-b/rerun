import { Output, ToolLoopAgent, stepCountIs } from 'ai';
import { z } from 'zod';
import type { Diagnosis, IncidentContext, Patch, PatchFile, VerifyResult } from '../shared/types';
import { PROMPTS } from './prompts/generated';
import {
  diagnosesBrief,
  emitDone,
  emitStep,
  finalStepWithoutTools,
  incidentBrief,
  modelIdOf,
  toUsage,
  verifyBrief,
  type AgentDeps,
} from './runtime';
import { providerDocTools } from './tools/artifacts';
import { fileTools, writeTools } from './tools/files';
import { materializeRepo, type Workdir } from './workdir';

export const FIX_MAX_STEPS = 15;
export const TITLE_MAX_CHARS = 70;

export class NoChangeError extends Error {
  constructor(readonly summary: string) {
    super(`The Fix agent made no change${summary ? `: ${summary}` : ''}`);
    this.name = 'NoChangeError';
  }
}

export const fixOutputSchema = z.object({
  title: z.string().describe(`Imperative PR title, at most ${TITLE_MAX_CHARS} characters`),
  summary: z.string().describe('Two or three sentences: cause, change, why it is safe'),
});

export function createFixAgent(ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) {
  return new ToolLoopAgent({
    id: 'rerun-fix',
    model: deps.model,
    instructions: PROMPTS.fix,
    tools: {
      ...fileTools(workdir),
      ...writeTools(workdir, ctx.triage?.failureClass.choice),
      ...providerDocTools(deps.mcpTools),
    },
    output: Output.object({ schema: fixOutputSchema, name: 'fix' }),
    stopWhen: stepCountIs(FIX_MAX_STEPS),
    prepareStep: finalStepWithoutTools(FIX_MAX_STEPS),
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'rerun.fix',
      metadata: { incidentId: ctx.incidentId, runId: ctx.runId },
    },
  });
}

export function clampTitle(title: string): string {
  const oneLine = title.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= TITLE_MAX_CHARS) return oneLine;
  const cut = oneLine.slice(0, TITLE_MAX_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > 40 ? cut.slice(0, space) : cut).trimEnd();
}

/**
 * Runs the Fix agent on a fresh working copy of `deps.files` and returns the exact diff as a Patch.
 * For the verify retry pass the failed `previousVerify` and the `previousPatch` it verified: the
 * agent starts from the patched files and the returned Patch is still against `deps.files`.
 */
export async function runFix(
  ctx: IncidentContext,
  diagnoses: Diagnosis[],
  deps: AgentDeps,
  previousVerify?: VerifyResult,
  previousPatch: PatchFile[] = [],
): Promise<Patch> {
  const workdir = await materializeRepo({ files: deps.files, apply: previousVerify ? previousPatch : [] });
  try {
    const prompt = [
      incidentBrief(ctx, workdir),
      '',
      diagnosesBrief(diagnoses),
      previousVerify ? `\n${verifyBrief(previousVerify, previousPatch)}` : '',
    ].join('\n');
    const result = await createFixAgent(ctx, workdir, deps).generate({
      prompt,
      onStepFinish: (s) => emitStep(deps, ctx.incidentId, 'fix', s),
    });
    await emitDone(
      deps,
      ctx.incidentId,
      'fix',
      result.steps.length,
      toUsage(result.totalUsage),
      modelIdOf(deps.model),
    );
    const files = workdir.diff();
    const { title, summary } = result.output;
    if (files.length === 0) throw new NoChangeError(summary.trim());
    return {
      files: files.map((f) => ({ ...f, rationale: f.rationale || 'Change made by the Fix agent.' })),
      title: clampTitle(title),
      summary: summary.trim(),
    };
  } finally {
    await workdir.cleanup();
  }
}
