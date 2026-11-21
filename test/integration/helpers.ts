import { loadConfig } from '../../src/config';
import { openDb, type Db } from '../../src/db';
import { approveIncident } from '../../src/incident/approval';
import {
  runIncidentPipeline,
  type AwaitApproval,
  type PipelineOutcome,
  type PipelineSteps,
} from '../../src/incident/pipeline';
import { setIncidentServices, type IncidentServices } from '../../src/incident/services';
import * as steps from '../../src/incident/steps';
import { startMockServer, type MockServerHandle } from '../../src/mcp/mock/server';

export const pipelineSteps: PipelineSteps = {
  collect: steps.collectStep,
  triage: steps.triageStep,
  diagnose: steps.diagnoseStep,
  fix: steps.fixStep,
  verify: steps.verifyStep,
  giveUp: steps.giveUpStep,
  propose: steps.proposeStep,
  isApproved: steps.isApprovedStep,
  markAwaiting: steps.markAwaitingStep,
  confirm: steps.confirmStep,
  fail: steps.failStep,
};

/** Stands in for the Workflow SDK hook: marks the incident awaiting, then approves it like the dashboard. */
export const approveImmediately: AwaitApproval = async (incidentId, ready) => {
  await ready();
  const { sha } = await approveIncident(incidentId);
  return { approvedBy: 'dashboard', mergeSha: sha };
};

export interface Harness {
  db: Db;
  mock: MockServerHandle;
  runs: Promise<PipelineOutcome>[];
  close(): Promise<void>;
}

/** Demo-mode services over an in-memory DB and the in-process mock MCP server; workflows run inline. */
export async function startHarness(
  opts: { awaitApproval?: AwaitApproval; override?: Partial<IncidentServices> } = {},
): Promise<Harness> {
  const mock = await startMockServer({ port: 0 });
  const db = await openDb('file::memory:');
  const config = loadConfig({ RERUN_MODE: 'demo', TERRAFORM_MCP_URL: mock.url, TFE_ORG: 'hashi-org-TF' });
  const runs: Promise<PipelineOutcome>[] = [];
  const awaitApproval = opts.awaitApproval ?? approveImmediately;
  setIncidentServices({
    config,
    db: async () => db,
    startWorkflow: async (incidentId, runId) => {
      runs.push(runIncidentPipeline(incidentId, runId, pipelineSteps, awaitApproval));
      return `inline-${incidentId}`;
    },
    resumeApproval: async () => true,
    watch: { timeoutMs: 5_000, pollMs: 10 },
    ...opts.override,
  });
  return {
    db,
    mock,
    runs,
    close: async () => {
      setIncidentServices(undefined);
      await mock.close();
    },
  };
}
