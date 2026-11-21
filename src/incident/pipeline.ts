// The incident pipeline (SPEC §2) as plain orchestration over the step functions. `workflows/incident.ts`
// runs it inside the Workflow SDK with `"use step"` wrappers and an approval hook; tests run it directly.
// No Node.js imports here: this module is bundled into the deterministic workflow sandbox.

export const approvalToken = (incidentId: string) => `rerun:approve:${incidentId}`;

export interface ApprovalSignal {
  approvedBy: string;
  mergeSha: string;
}

export interface PipelineSteps {
  collect(incidentId: string, runId: string): Promise<unknown>;
  triage(incidentId: string): Promise<{ route: string }>;
  diagnose(incidentId: string): Promise<unknown>;
  fix(incidentId: string, attempt: number): Promise<unknown>;
  verify(incidentId: string, attempt: number): Promise<{ ok: boolean }>;
  giveUp(incidentId: string): Promise<unknown>;
  propose(incidentId: string): Promise<{ draft: boolean }>;
  isApproved(incidentId: string): Promise<boolean>;
  markAwaiting(incidentId: string): Promise<void>;
  confirm(incidentId: string): Promise<unknown>;
  fail(incidentId: string, step: string, message: string): Promise<void>;
}

/**
 * Waits for the approve route. Implementations create the hook first, then call `ready()` (which lets the
 * dashboard approve), then resolve when the hook is resumed.
 */
export type AwaitApproval = (incidentId: string, ready: () => Promise<void>) => Promise<ApprovalSignal>;

export type PipelineOutcome = 'awaiting_human' | 'confirmed' | 'needs_human' | 'failed';

export async function runIncidentPipeline(
  incidentId: string,
  runId: string,
  steps: PipelineSteps,
  awaitApproval: AwaitApproval,
): Promise<PipelineOutcome> {
  let current = 'collect';
  try {
    await steps.collect(incidentId, runId);
    current = 'triage';
    await steps.triage(incidentId);
    current = 'diagnose';
    await steps.diagnose(incidentId);
    current = 'fix';
    await steps.fix(incidentId, 1);
    current = 'verify';
    let verified = await steps.verify(incidentId, 1);
    if (!verified.ok) {
      current = 'fix';
      await steps.fix(incidentId, 2);
      current = 'verify';
      verified = await steps.verify(incidentId, 2);
      if (!verified.ok) {
        await steps.giveUp(incidentId);
        return 'needs_human';
      }
    }
    current = 'propose';
    await steps.propose(incidentId);
    current = 'await';
    if (!(await steps.isApproved(incidentId))) {
      await awaitApproval(incidentId, () => steps.markAwaiting(incidentId));
    }
    current = 'confirm';
    await steps.confirm(incidentId);
    return 'confirmed';
  } catch (error) {
    await steps.fail(incidentId, current, error instanceof Error ? error.message : String(error));
    return 'failed';
  }
}
