import { randomUUID } from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FailureClass, IncidentEvent, IncidentStatus, Stage } from '../shared/types';
import type { Db } from './index';
import {
  artifacts,
  decisions,
  incidentEvents,
  incidents,
  type ArtifactRow,
  type ArtifactType,
  type DecisionRow,
  type IncidentRow,
} from './schema';

export type Incident = IncidentRow;

export interface IncidentDetail extends Incident {
  events: IncidentEvent[];
  decisions: DecisionRow[];
  artifacts: ArtifactRow[];
}

export interface CreateIncidentInput {
  id?: string;
  runId: string;
  workspace: string;
  status?: IncidentStatus;
  failureClass?: FailureClass | null;
  stage?: Stage | null;
  parentIncidentId?: string | null;
  createdAt?: string;
}

export type IncidentPatch = Partial<
  Pick<
    Incident,
    | 'failureClass'
    | 'stage'
    | 'route'
    | 'prUrl'
    | 'prNumber'
    | 'needsHuman'
    | 'resolvedAt'
    | 'costUsd'
    | 'parentIncidentId'
  >
>;

export async function createIncident(db: Db, input: CreateIncidentInput): Promise<Incident> {
  const [row] = await db
    .insert(incidents)
    .values({
      id: input.id ?? randomUUID(),
      runId: input.runId,
      workspace: input.workspace,
      status: input.status ?? 'collecting',
      failureClass: input.failureClass ?? null,
      stage: input.stage ?? null,
      parentIncidentId: input.parentIncidentId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();
  return row;
}

/** Sets the status (plus any other columns in `patch`); `resolved` stamps `resolvedAt` unless already set. */
export async function setStatus(
  db: Db,
  id: string,
  status: IncidentStatus,
  patch: IncidentPatch = {},
): Promise<Incident> {
  const resolvedAt =
    status === 'resolved' && patch.resolvedAt === undefined
      ? sql`COALESCE(${incidents.resolvedAt}, ${new Date().toISOString()})`
      : patch.resolvedAt;
  const [row] = await db
    .update(incidents)
    .set({ ...patch, status, ...(resolvedAt !== undefined ? { resolvedAt } : {}) })
    .where(eq(incidents.id, id))
    .returning();
  if (!row) throw new Error(`Incident ${id} not found`);
  return row;
}

export interface AppendEventInput {
  step: string;
  kind: IncidentEvent['kind'];
  title: string;
  payload?: unknown;
  at?: string;
}

/** Appends an event with the next `seq` for the incident (1-based, assigned atomically). */
export async function appendEvent(
  db: Db,
  incidentId: string,
  event: AppendEventInput,
): Promise<IncidentEvent> {
  const at = event.at ?? new Date().toISOString();
  const payloadJson = JSON.stringify(event.payload ?? null);
  const [row] = await db
    .insert(incidentEvents)
    .values({
      incidentId,
      seq: sql`(SELECT COALESCE(MAX(${incidentEvents.seq}), 0) + 1 FROM ${incidentEvents} WHERE ${incidentEvents.incidentId} = ${incidentId})`,
      at,
      step: event.step,
      kind: event.kind,
      title: event.title,
      payloadJson,
    })
    .returning();
  return toEvent(row);
}

export async function listIncidents(db: Db, opts: { limit?: number } = {}): Promise<Incident[]> {
  return db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.createdAt))
    .limit(opts.limit ?? 200);
}

export async function getIncident(db: Db, id: string): Promise<IncidentDetail | null> {
  const [incident] = await db.select().from(incidents).where(eq(incidents.id, id));
  if (!incident) return null;
  const [eventRows, decisionRows, artifactRows] = await Promise.all([
    db
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, id))
      .orderBy(asc(incidentEvents.seq)),
    db.select().from(decisions).where(eq(decisions.incidentId, id)).orderBy(asc(decisions.id)),
    db.select().from(artifacts).where(eq(artifacts.incidentId, id)).orderBy(asc(artifacts.id)),
  ]);
  return { ...incident, events: eventRows.map(toEvent), decisions: decisionRows, artifacts: artifactRows };
}

export async function addArtifact(
  db: Db,
  incidentId: string,
  artifact: { type: ArtifactType; name: string; content: string },
): Promise<ArtifactRow> {
  const [row] = await db
    .insert(artifacts)
    .values({ incidentId, ...artifact })
    .returning();
  return row;
}

export async function addDecision(
  db: Db,
  incidentId: string,
  decision: {
    provider: DecisionRow['provider'];
    request: unknown;
    response: unknown;
    inputTokens: number;
    latencyMs: number;
    at?: string;
  },
): Promise<DecisionRow> {
  const [row] = await db
    .insert(decisions)
    .values({
      incidentId,
      provider: decision.provider,
      requestJson: JSON.stringify(decision.request),
      responseJson: JSON.stringify(decision.response),
      inputTokens: decision.inputTokens,
      latencyMs: decision.latencyMs,
      ...(decision.at ? { at: decision.at } : {}),
    })
    .returning();
  return row;
}

function toEvent(row: typeof incidentEvents.$inferSelect): IncidentEvent {
  return {
    incidentId: row.incidentId,
    seq: row.seq,
    at: row.at,
    step: row.step,
    kind: row.kind,
    title: row.title,
    payload: JSON.parse(row.payloadJson) as unknown,
  };
}
