import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { FailureClass, IncidentEvent, IncidentStatus, Route, Stage } from '../shared/types';

export const ARTIFACT_TYPES = ['log', 'plan_json', 'diff', 'verify_output', 'pr_body'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const incidents = sqliteTable(
  'incidents',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    workspace: text('workspace').notNull(),
    status: text('status').$type<IncidentStatus>().notNull(),
    failureClass: text('failure_class').$type<FailureClass>(),
    stage: text('stage').$type<Stage>(),
    route: text('route').$type<Route>(),
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    needsHuman: integer('needs_human', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull().default(now),
    resolvedAt: text('resolved_at'),
    costUsd: real('cost_usd').notNull().default(0),
    parentIncidentId: text('parent_incident_id'),
  },
  (t) => [uniqueIndex('incidents_run_id_idx').on(t.runId), index('incidents_created_at_idx').on(t.createdAt)],
);

export const incidentEvents = sqliteTable(
  'incident_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    incidentId: text('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    at: text('at').notNull().default(now),
    step: text('step').notNull(),
    kind: text('kind').$type<IncidentEvent['kind']>().notNull(),
    title: text('title').notNull(),
    payloadJson: text('payload_json').notNull().default('null'),
  },
  (t) => [uniqueIndex('incident_events_incident_seq_idx').on(t.incidentId, t.seq)],
);

export const decisions = sqliteTable(
  'decisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    incidentId: text('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'jev' | 'llm' | 'recorded'>().notNull(),
    requestJson: text('request_json').notNull(),
    responseJson: text('response_json').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    at: text('at').notNull().default(now),
  },
  (t) => [index('decisions_incident_idx').on(t.incidentId)],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    incidentId: text('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    type: text('type').$type<ArtifactType>().notNull(),
    name: text('name').notNull(),
    content: text('content').notNull(),
  },
  (t) => [index('artifacts_incident_idx').on(t.incidentId)],
);

export type IncidentRow = typeof incidents.$inferSelect;
export type IncidentEventRow = typeof incidentEvents.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
