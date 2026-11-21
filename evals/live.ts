import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Incident, IncidentDetail } from '../src/db/incidents';
import type { IncidentStatus, PatchFile, VerifyResult } from '../src/shared/types';

export interface LiveScenarioResult {
  reachedStatus: string;
  verifierOk: boolean;
  prUrl: string | null;
  durationMs: number;
  /** The PR changed only `expected.fixTouches` paths and none of `mustNotTouch`; null if no PR. */
  fixTouchesRespected?: boolean | null;
}

export type RunLiveScenario = (name: string) => Promise<LiveScenarioResult>;

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = 'NotImplemented';
  }
}

/** Statuses where the live eval stops waiting: a PR awaits review, or the workflow has finished. */
export const SETTLED: IncidentStatus[] = ['awaiting_approval', 'needs_human', 'resolved', 'failed'];

export interface LiveScenarioDeps {
  /** The errored run to triage for scenario `name` (the run W2-L's breaker produced). */
  runIdFor(name: string): Promise<string> | string;
  start(runId: string): Promise<{ incident: Incident }>;
  load(incidentId: string): Promise<IncidentDetail | null | undefined>;
  expected(name: string): { fixTouches: string[]; mustNotTouch: string[] };
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
}

interface CompletedPayload {
  completed?: string;
  result?: unknown;
}

function completed(detail: IncidentDetail, prefix: string): unknown[] {
  return detail.events
    .map((e) => e.payload as CompletedPayload | null)
    .filter(
      (p): p is CompletedPayload =>
        !!p && typeof p.completed === 'string' && p.completed.split('#')[0] === prefix,
    )
    .map((p) => p.result);
}

/** Drives the real incident workflow (`startIncident`) for one scenario and reports where it got to. */
export function createLiveScenarioRunner(deps: LiveScenarioDeps): RunLiveScenario {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? 15 * 60_000;
  const pollMs = deps.pollMs ?? 2_000;
  return async (name) => {
    const started = now();
    const { incident } = await deps.start(await deps.runIdFor(name));
    let detail = await deps.load(incident.id);
    while (!detail || !SETTLED.includes(detail.status as IncidentStatus)) {
      if (now() - started > timeoutMs) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      detail = await deps.load(incident.id);
    }
    const verifies = detail ? (completed(detail, 'verify') as VerifyResult[]) : [];
    const fixes = detail ? (completed(detail, 'fix') as { patch: { files: PatchFile[] } }[]) : [];
    const prUrl = detail?.prUrl ?? null;
    let fixTouchesRespected: boolean | null = null;
    if (prUrl && fixes.length > 0) {
      const { fixTouches, mustNotTouch } = deps.expected(name);
      const touched = fixes.at(-1)!.patch.files.map((f) => f.path);
      fixTouchesRespected = touched.every((p) => fixTouches.includes(p) && !mustNotTouch.includes(p));
    }
    return {
      reachedStatus: detail?.status ?? 'unknown',
      verifierOk: verifies.at(-1)?.ok ?? false,
      prUrl,
      durationMs: now() - started,
      fixTouchesRespected,
    };
  };
}

const SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');

/** Live default: the run id comes from `RERUN_LIVE_RUN_<SCENARIO>` (W2-L) or the recorded fixture. */
export const runLiveScenario: RunLiveScenario = async (name) => {
  const [{ startIncident }, { incidentServices }, { getIncident }, { runIdForScenario }] = await Promise.all([
    import('../src/incident/start'),
    import('../src/incident/services'),
    import('../src/db/incidents'),
    import('../src/incident/demo'),
  ]);
  return createLiveScenarioRunner({
    runIdFor: (n) =>
      process.env[`RERUN_LIVE_RUN_${n.toUpperCase().replace(/-/g, '_')}`] ?? runIdForScenario(n),
    start: (runId) => startIncident(runId),
    load: async (id) => getIncident(await incidentServices().db(), id),
    expected: (n) => JSON.parse(readFileSync(path.join(SCENARIOS_DIR, n, 'expected.json'), 'utf8')),
  })(name);
};
