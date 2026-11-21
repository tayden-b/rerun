import type { LanguageModel } from 'ai';
import { config as defaultConfig, type Config } from '../config';
import { createDecisionProvider } from '../decisions/factory';
import { getDb, type Db } from '../db';
import { createGitHub, type GitHubClient } from '../github';
import { createTerraformMcp, type TerraformMcp } from '../mcp/terraform';
import { agentModel } from '../models';
import type { DecisionProvider, Verifier } from '../shared/types';
import { createVerifier } from '../verify';
import { toRunLister, type RunLister } from '../watch/runs';
import { approvalToken, type ApprovalSignal } from './pipeline';
import { resumeApprovalHook } from './hook';
import { demoNextRuns, demoRepoFiles, loadTranscript, scenarioForRun, scriptedAgentModel } from './demo';

/** Everything the incident steps talk to. Demo mode wires recordings; tests override pieces. */
export interface IncidentServices {
  config: Config;
  db(): Promise<Db>;
  /** Recorded scenario for a run (demo mode only). */
  scenarioFor(runId: string): string | undefined;
  mcp(scenario?: string): Promise<TerraformMcp>;
  decisions(scenario?: string): DecisionProvider;
  github(scenario?: string): GitHubClient;
  verifier(scenario?: string): Verifier;
  model(scenario?: string): LanguageModel;
  runLister(mcp: TerraformMcp, afterRunId: string): RunLister;
  watch: { timeoutMs: number; pollMs: number };
  /** Starts `incidentWorkflow` (the Workflow SDK run); tests run the pipeline directly instead. */
  startWorkflow(incidentId: string, runId: string): Promise<string>;
  /** Resumes the workflow waiting on the approval hook; false when no workflow is waiting. */
  resumeApproval(incidentId: string, signal: ApprovalSignal): Promise<boolean>;
  /** Absolute dashboard URL of an incident, for the PR body. */
  incidentUrl(incidentId: string): string;
}

const KEY = Symbol.for('rerun.incident.services');
const GITHUB_KEY = Symbol.for('rerun.incident.github');
type Store = typeof globalThis & {
  [KEY]?: Partial<IncidentServices>;
  [GITHUB_KEY]?: Map<string, GitHubClient>;
};
const store = globalThis as Store;

function withScenario(url: string, scenario: string | undefined): string {
  if (!scenario) return url;
  const u = new URL(url);
  u.searchParams.set('scenario', scenario);
  return u.toString();
}

/** One GitHub client per process (per demo scenario), shared by workflow steps and API routes. */
function github(config: Config, scenario?: string): GitHubClient {
  const cache = (store[GITHUB_KEY] ??= new Map());
  const key = config.mode === 'demo' ? `demo:${scenario ?? ''}` : 'live';
  let client = cache.get(key);
  if (!client) {
    const files = config.mode === 'demo' && scenario ? demoRepoFiles(loadTranscript(scenario)) : undefined;
    client = createGitHub(config, { fake: { files } });
    cache.set(key, client);
  }
  return client;
}

function defaults(config: Config): IncidentServices {
  const demo = config.mode === 'demo';
  // Set by `npm run demo` so the replay streams at a believable pace; tests replay instantly.
  const pace = demo && config.demoPace;
  return {
    config,
    db: () => getDb(config.databaseUrl),
    scenarioFor: (runId) => (demo ? scenarioForRun(runId) : undefined),
    mcp: (scenario) =>
      createTerraformMcp({
        url: withScenario(config.terraformMcpUrl, demo ? scenario : undefined),
        workspace: config.workspace,
        org: config.tfeOrg ?? '',
      }),
    decisions: (scenario) => createDecisionProvider(config, { scenario: demo ? scenario : undefined }),
    github: (scenario) => github(config, scenario),
    verifier: (scenario) => createVerifier(config, { scenario, pace }),
    model: (scenario) => (demo ? scriptedAgentModel(loadTranscript(scenario ?? ''), { pace }) : agentModel()),
    runLister: (mcp, afterRunId) => {
      const lister = toRunLister({ listRuns: async (opts) => (await mcp.listRuns(opts)).runs }, (r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at ?? new Date(0).toISOString(),
      }));
      if (!demo) return lister;
      return { listRuns: async (opts) => demoNextRuns(await lister.listRuns(opts), afterRunId, new Date()) };
    },
    watch: demo ? { timeoutMs: 30_000, pollMs: 500 } : { timeoutMs: 45 * 60_000, pollMs: 15_000 },
    startWorkflow: async (incidentId, runId) => {
      const [{ start }, { incidentWorkflow }] = await Promise.all([
        import('workflow/api'),
        import('../../workflows/incident'),
      ]);
      return (await start(incidentWorkflow, [incidentId, runId])).runId;
    },
    resumeApproval: (incidentId, signal) => resumeApprovalHook(approvalToken(incidentId), signal),
    incidentUrl: (id) => `http://localhost:${process.env.PORT ?? 3000}/incidents/${encodeURIComponent(id)}`,
  };
}

export function incidentServices(): IncidentServices {
  const override = store[KEY] ?? {};
  return { ...defaults(override.config ?? defaultConfig), ...override };
}

/** Tests: replace some services for this process; `undefined` restores the defaults. */
export function setIncidentServices(override: Partial<IncidentServices> | undefined): void {
  store[KEY] = override;
  store[GITHUB_KEY] = undefined;
}
