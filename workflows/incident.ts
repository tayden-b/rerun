import { defineHook } from 'workflow';
import { approvalToken, runIncidentPipeline, type ApprovalSignal } from '../src/incident/pipeline';

// SPEC §2 as a durable Workflow SDK run. The body only sequences steps; every step is a `"use step"`
// wrapper that loads the implementation in `src/incident/steps.ts` (Node.js, DB, MCP, GitHub, LLM).
// Await (step 7) is a hook with the deterministic token `rerun:approve:<incidentId>`, resumed by
// `POST /api/incidents/<id>/approve` after the merge.

export const approvalHook = defineHook<ApprovalSignal>();

export async function incidentWorkflow(incidentId: string, runId: string) {
  'use workflow';
  return runIncidentPipeline(
    incidentId,
    runId,
    { collect, triage, diagnose, fix, verify, giveUp, propose, isApproved, markAwaiting, confirm, fail },
    async (id, ready) => {
      const hook = approvalHook.create({ token: approvalToken(id) });
      await ready();
      return await hook;
    },
  );
}

const impl = () => import('../src/incident/steps');

async function collect(incidentId: string, runId: string) {
  'use step';
  await (await impl()).collectStep(incidentId, runId);
  return null;
}

async function triage(incidentId: string) {
  'use step';
  return (await impl()).triageStep(incidentId);
}

async function diagnose(incidentId: string) {
  'use step';
  return (await impl()).diagnoseStep(incidentId);
}

async function fix(incidentId: string, attempt: number) {
  'use step';
  return (await impl()).fixStep(incidentId, attempt);
}

async function verify(incidentId: string, attempt: number) {
  'use step';
  return (await impl()).verifyStep(incidentId, attempt);
}

async function giveUp(incidentId: string) {
  'use step';
  return (await impl()).giveUpStep(incidentId);
}

async function propose(incidentId: string) {
  'use step';
  return (await impl()).proposeStep(incidentId);
}

async function isApproved(incidentId: string) {
  'use step';
  return (await impl()).isApprovedStep(incidentId);
}

async function markAwaiting(incidentId: string) {
  'use step';
  return (await impl()).markAwaitingStep(incidentId);
}

async function confirm(incidentId: string) {
  'use step';
  return (await impl()).confirmStep(incidentId);
}

async function fail(incidentId: string, step: string, message: string) {
  'use step';
  return (await impl()).failStep(incidentId, step, message);
}
