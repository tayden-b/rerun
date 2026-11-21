import type { IncidentContext } from '../shared/types';
import { createDiagnosisAgent, runDiagnosisAgent, type DiagnosisAgentSpec } from './diagnosis';
import { PROMPTS } from './prompts/generated';
import type { AgentDeps } from './runtime';
import { artifactTools, logTools } from './tools/artifacts';
import { fileTools } from './tools/files';
import type { Workdir } from './workdir';

export const REALITY_AGENT: DiagnosisAgentSpec = {
  name: 'reality',
  instructions: PROMPTS.reality,
  maxSteps: 10,
  tools: (ctx, workdir) => ({
    ...artifactTools(ctx.artifacts),
    ...logTools(ctx.artifacts),
    read_file: fileTools(workdir).read_file,
  }),
};

export const createRealityAgent = (ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) =>
  createDiagnosisAgent(REALITY_AGENT, ctx, workdir, deps);

export const runRealityAgent = (ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) =>
  runDiagnosisAgent(REALITY_AGENT, ctx, workdir, deps);
