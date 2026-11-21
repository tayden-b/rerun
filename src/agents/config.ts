import type { IncidentContext } from '../shared/types';
import { createDiagnosisAgent, runDiagnosisAgent, type DiagnosisAgentSpec } from './diagnosis';
import { PROMPTS } from './prompts/generated';
import type { AgentDeps } from './runtime';
import { logTools, providerDocTools } from './tools/artifacts';
import { fileTools } from './tools/files';
import type { Workdir } from './workdir';

export const CONFIG_AGENT: DiagnosisAgentSpec = {
  name: 'config',
  instructions: PROMPTS.config,
  maxSteps: 12,
  tools: (ctx, workdir, deps) => ({
    ...fileTools(workdir),
    ...providerDocTools(deps.mcpTools),
    ...logTools(ctx.artifacts),
  }),
};

export const createConfigAgent = (ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) =>
  createDiagnosisAgent(CONFIG_AGENT, ctx, workdir, deps);

export const runConfigAgent = (ctx: IncidentContext, workdir: Workdir, deps: AgentDeps) =>
  runDiagnosisAgent(CONFIG_AGENT, ctx, workdir, deps);
