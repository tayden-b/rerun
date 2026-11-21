import { eq } from 'drizzle-orm';
import { appendEvent, createIncident, setStatus, type Incident } from '../db/incidents';
import { incidents } from '../db/schema';
import { redact } from '../shared/redact';
import { incidentServices } from './services';
import { completedResult } from './store';

export interface StartIncidentResult {
  incident: Incident;
  /** False when an incident for this run already existed (nothing was started). */
  created: boolean;
}

const LOCKS = Symbol.for('rerun.incident.startLocks');
const locks = ((globalThis as typeof globalThis & { [LOCKS]?: Map<string, Promise<StartIncidentResult>> })[
  LOCKS
] ??= new Map());

/**
 * One incident per run (SPEC §2): returns the existing incident for `runId`, or creates one and starts
 * the incident workflow. Used by the poller, the webhook, the demo and the live evals.
 */
export function startIncident(
  runId: string,
  opts: { parentIncidentId?: string } = {},
): Promise<StartIncidentResult> {
  const pending = locks.get(runId);
  if (pending) return pending.then((r: StartIncidentResult) => ({ ...r, created: false }));
  const work = startOnce(runId, opts).finally(() => locks.delete(runId));
  locks.set(runId, work);
  return work;
}

async function startOnce(runId: string, opts: { parentIncidentId?: string }): Promise<StartIncidentResult> {
  const services = incidentServices();
  const db = await services.db();
  const [existing] = await db.select().from(incidents).where(eq(incidents.runId, runId)).limit(1);
  // A row left `failed` by a dispatch error (no step ever ran) is retried instead of returned.
  const retry = existing?.status === 'failed' && !(await completedResult(db, existing.id, 'collect'));
  if (existing && !retry) return { incident: existing, created: false };
  const incident =
    existing ??
    (await createIncident(db, {
      runId,
      workspace: services.config.workspace,
      parentIncidentId: opts.parentIncidentId ?? null,
    }));
  try {
    await services.startWorkflow(incident.id, runId);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    await appendEvent(db, incident.id, { step: 'collect', kind: 'error', title: message, payload: null });
    await setStatus(db, incident.id, 'failed');
    throw error;
  }
  return { incident, created: true };
}
