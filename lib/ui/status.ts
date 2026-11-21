import type { FailureClass, IncidentStatus, Route } from '@/src/shared/types';

export type StatusTone = 'active' | 'attention' | 'warning' | 'success' | 'neutral' | 'danger';

export const STATUS_META: Record<IncidentStatus, { label: string; tone: StatusTone }> = {
  collecting: { label: 'Collecting', tone: 'active' },
  triaging: { label: 'Triaging', tone: 'active' },
  diagnosing: { label: 'Diagnosing', tone: 'active' },
  fixing: { label: 'Fixing', tone: 'active' },
  verifying: { label: 'Verifying', tone: 'active' },
  proposing: { label: 'Proposing', tone: 'active' },
  awaiting_approval: { label: 'Awaiting approval', tone: 'attention' },
  merged: { label: 'Merged', tone: 'neutral' },
  confirming: { label: 'Confirming', tone: 'active' },
  resolved: { label: 'Resolved', tone: 'success' },
  needs_human: { label: 'Needs human', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const INCIDENT_STATUSES = Object.keys(STATUS_META) as IncidentStatus[];

/** Dot and text colour per tone. One accent (`brand`) marks work in progress. */
export const TONE_CLASSES: Record<StatusTone, { dot: string; text: string }> = {
  active: { dot: 'bg-brand', text: 'text-brand' },
  attention: { dot: 'bg-attention', text: 'text-attention' },
  warning: { dot: 'bg-warning', text: 'text-warning' },
  success: { dot: 'bg-success', text: 'text-success' },
  neutral: { dot: 'bg-muted-foreground', text: 'text-muted-foreground' },
  danger: { dot: 'bg-destructive', text: 'text-destructive' },
};

export function statusMeta(status: string): { label: string; tone: StatusTone } {
  return STATUS_META[status as IncidentStatus] ?? { label: status, tone: 'neutral' };
}

export function isInProgress(status: string): boolean {
  return statusMeta(status).tone === 'active';
}

export const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  config_syntax: 'Config syntax',
  config_reference: 'Config reference',
  missing_input: 'Missing input',
  provider_version: 'Provider version',
  provider_auth: 'Provider auth',
  provider_api_error: 'Provider API error',
  apply_runtime: 'Apply runtime',
  precondition_failed: 'Precondition failed',
  module_source: 'Module source',
  dependency_cycle: 'Dependency cycle',
  drift: 'Drift',
  unknown: 'Unknown',
};

export const FAILURE_CLASSES = Object.keys(FAILURE_CLASS_LABELS) as FailureClass[];

export function failureClassLabel(value: string | null | undefined): string {
  if (!value) return 'Unclassified';
  return FAILURE_CLASS_LABELS[value as FailureClass] ?? value;
}

export const ROUTE_LABELS: Record<Route, string> = { autoPr: 'Auto PR', draftPr: 'Draft PR' };
