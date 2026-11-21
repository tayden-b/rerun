import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Incident, IncidentDetail } from '../src/db/incidents';
import type { IncidentStatus, PatchFile, PullRequest, VerifyResult } from '../src/shared/types';

export interface LiveScenarioResult {
  reachedStatus: string;
  verifierOk: boolean;
  prUrl: string | null;
  durationMs: number;
  /** The PR changed only `expected.fixTouches` paths and none of `mustNotTouch`; null if no PR. */
  fixTouchesRespected?: boolean | null;
  runId?: string;
  incidentId?: string;
  failureClass?: string | null;
  route?: string | null;
  draft?: boolean | null;
  costUsd?: number;
  /** Jev input tokens plus the agents' tokens, from the incident's own records. */
  inputTokens?: number;
  outputTokens?: number;
  /** Wall time per phase: break (push → errored run), incident (start → settled), reset. */
  phasesMs?: Record<string, number>;
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
  start(runId: string): Promise<{ incident: Pick<Incident, 'id'> }>;
  load(incidentId: string): Promise<IncidentDetail | null | undefined>;
  expected(name: string): { fixTouches: string[]; mustNotTouch: string[] };
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  /** Runs once the incident settles (or times out), even when the result is a failure. */
  cleanup?(detail: IncidentDetail | null | undefined, runId: string): Promise<void>;
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
    const t0 = now();
    const runId = await deps.runIdFor(name);
    const t1 = now();
    let detail: IncidentDetail | null | undefined;
    try {
      const { incident } = await deps.start(runId);
      // A failed read must not end the wait: cleanup resets the shared workspace under a running incident.
      const load = () => deps.load(incident.id).catch(() => detail);
      detail = await load();
      while (!detail || !SETTLED.includes(detail.status as IncidentStatus)) {
        if (now() - t1 > timeoutMs) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        detail = await load();
      }
    } finally {
      await deps.cleanup?.(detail, runId);
    }
    const t2 = now();
    const verifies = detail ? (completed(detail, 'verify') as VerifyResult[]) : [];
    const fixes = detail ? (completed(detail, 'fix') as { patch: { files: PatchFile[] } }[]) : [];
    const proposed = detail ? (completed(detail, 'propose') as { pr: PullRequest }[]) : [];
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
      durationMs: t2 - t1,
      fixTouchesRespected,
      runId,
      incidentId: detail?.id,
      failureClass: detail?.failureClass ?? null,
      route: detail?.route ?? null,
      draft: proposed.at(-1)?.pr.draft ?? null,
      costUsd: detail?.costUsd ?? 0,
      ...(detail ? tokens(detail) : {}),
      phasesMs: { break: t1 - t0, incident: t2 - t1 },
    };
  };
}

/** Jev input tokens (decisions rows) plus each agent's final usage event. */
function tokens(detail: IncidentDetail): { inputTokens: number; outputTokens: number } {
  let inputTokens = (detail.decisions ?? []).reduce((n, d) => n + d.inputTokens, 0);
  let outputTokens = 0;
  for (const e of detail.events ?? []) {
    const p = e.payload as {
      done?: unknown;
      usage?: { inputTokens?: unknown; outputTokens?: unknown };
    } | null;
    if (e.kind !== 'agent_step' || p?.done !== true || !p.usage) continue;
    inputTokens += Number(p.usage.inputTokens) || 0;
    outputTokens += Number(p.usage.outputTokens) || 0;
  }
  return { inputTokens, outputTokens };
}

const SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');

/**
 * Live default (SPEC §8.4): `break.sh <name>` → the errored run → `startIncident` → settled → close the PR
 * and delete its branch → `reset.sh` → the baseline run. `RERUN_LIVE_RUN_<SCENARIO>` skips the break and
 * triages an existing run instead (no reset). Scenarios run one at a time: they share the workspace.
 */
export const runLiveScenario: RunLiveScenario = async (name) => {
  const [{ incidentServices }, { getIncident }, { fixturesDriver }] = await Promise.all([
    import('../src/incident/services'),
    import('../src/db/incidents'),
    import('./liveFixtures'),
  ]);
  const services = incidentServices();
  const log = (line: string) => console.error(`  live ${name}: ${line}`);
  const fixtures = fixturesDriver({ dir: process.env.RERUN_FIXTURES_DIR, mcp: () => services.mcp(), log });
  const preset = process.env[`RERUN_LIVE_RUN_${name.toUpperCase().replace(/-/g, '_')}`];
  const github = services.github();
  const appUrl = liveAppUrl();
  const run = createLiveScenarioRunner({
    runIdFor: async (n) => preset ?? (await fixtures.break(n)),
    start: (runId) => {
      log(`errored run ${runId}; starting the incident`);
      return startIncidentViaApp(appUrl, runId);
    },
    load: async (id) => getIncident(await services.db(), id),
    expected: (n) => JSON.parse(readFileSync(path.join(SCENARIOS_DIR, n, 'expected.json'), 'utf8')),
    cleanup: async (detail, runId) => {
      if (detail?.prNumber) {
        log(`${detail.status}; closing PR #${detail.prNumber}`);
        await github.closePullRequest(detail.prNumber);
      }
      await github.deleteBranch(`rerun/fix-${runId}`).catch(() => undefined);
    },
  });
  let result: LiveScenarioResult;
  try {
    result = await run(name);
  } catch (error) {
    // The workspace is shared: the next scenario must start from the baseline even after a failure.
    if (!preset) await fixtures.reset().catch((e: unknown) => log(`reset failed: ${String(e)}`));
    throw error;
  }
  if (!preset) {
    const t = Date.now();
    const reset = await fixtures.reset();
    log(`reset ${reset ? `${reset.runId} ${reset.status}` : 'not needed'}`);
    result.phasesMs = { ...result.phasesMs, reset: Date.now() - t };
  }
  return result;
};

/** The running app the live eval starts incidents through; a blank `RERUN_APP_URL` means the default. */
export function liveAppUrl(env: Record<string, string | undefined> = process.env): string {
  return env.RERUN_APP_URL || `http://localhost:${env.PORT || 3000}`;
}

/**
 * `POST /api/incidents` on the running app. `start()` from `workflow/api` only works inside the Next
 * process that compiled the workflow, so a CLI cannot call `startIncident` itself.
 */
export async function startIncidentViaApp(
  appUrl: string,
  runId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ incident: { id: string }; created: boolean }> {
  const res = await fetchFn(new URL('/api/incidents', appUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId }),
  });
  if (!res.ok) throw new Error(`POST /api/incidents ${runId}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as { incident: { id: string }; created: boolean };
}
