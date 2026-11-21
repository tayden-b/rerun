import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { appendEvent, setStatus } from '../db/incidents';
import { decisions, incidentEvents, incidents } from '../db/schema';
import type { IncidentEvent, IncidentStatus } from '../shared/types';
import { summarizeIncidentCost, type AgentUsage } from '../telemetry/cost';

// Step idempotency (SPEC §2: "Steps are idempotent per (incidentId, step)"). A finished step appends one
// `status` event titled "<key> completed" whose payload carries the step's result; running the step again
// returns that stored result instead of repeating its side effects.

export const completedTitle = (key: string) => `${key} completed`;

export async function stepEvents(db: Db, incidentId: string, step?: string): Promise<IncidentEvent[]> {
  const rows = await db
    .select()
    .from(incidentEvents)
    .where(
      step
        ? and(eq(incidentEvents.incidentId, incidentId), eq(incidentEvents.step, step))
        : eq(incidentEvents.incidentId, incidentId),
    )
    .orderBy(asc(incidentEvents.seq));
  return rows.map((r) => ({
    incidentId: r.incidentId,
    seq: r.seq,
    at: r.at,
    step: r.step,
    kind: r.kind as IncidentEvent['kind'],
    title: r.title,
    payload: JSON.parse(r.payloadJson) as unknown,
  }));
}

export async function completedResult<T>(db: Db, incidentId: string, key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ payloadJson: incidentEvents.payloadJson })
    .from(incidentEvents)
    .where(
      and(
        eq(incidentEvents.incidentId, incidentId),
        eq(incidentEvents.kind, 'status'),
        eq(incidentEvents.title, completedTitle(key)),
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return (JSON.parse(row.payloadJson) as { result: T }).result;
}

export async function markCompleted(db: Db, incidentId: string, step: string, key: string, result: unknown) {
  await appendEvent(db, incidentId, {
    step,
    kind: 'status',
    title: completedTitle(key),
    payload: { completed: key, result: result ?? null },
  });
}

/** Sets the incident status and records it in the Trace, as the dashboard seed does. */
export async function enterStatus(
  db: Db,
  incidentId: string,
  step: string,
  status: IncidentStatus,
  patch?: Parameters<typeof setStatus>[3],
  extra?: Record<string, unknown>,
) {
  await setStatus(db, incidentId, status, patch);
  await appendEvent(db, incidentId, { step, kind: 'status', title: status, payload: { status, ...extra } });
}

export async function getStatus(db: Db, incidentId: string): Promise<IncidentStatus | undefined> {
  const [row] = await db
    .select({ status: incidents.status })
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  return row?.status as IncidentStatus | undefined;
}

/** Recomputes `incidents.costUsd` from the decisions rows and the agents' final usage events. */
export async function updateCost(db: Db, incidentId: string, fastModel: string): Promise<number> {
  const rows = await db.select().from(decisions).where(eq(decisions.incidentId, incidentId));
  const usages: AgentUsage[] = [];
  for (const event of await stepEvents(db, incidentId)) {
    const p = event.payload as { done?: unknown; usage?: Partial<AgentUsage> } | null;
    if (event.kind !== 'agent_step' || p?.done !== true || typeof p.usage?.model !== 'string') continue;
    usages.push({
      model: p.usage.model,
      inputTokens: Number(p.usage.inputTokens) || 0,
      outputTokens: Number(p.usage.outputTokens) || 0,
    });
  }
  const cost = summarizeIncidentCost(
    rows.map((r) => ({
      provider: r.provider as 'jev' | 'llm' | 'recorded',
      inputTokens: r.inputTokens,
      model: fastModel,
    })),
    usages,
  );
  await db.update(incidents).set({ costUsd: cost.totalUsd }).where(eq(incidents.id, incidentId));
  return cost.totalUsd;
}
