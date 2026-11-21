/**
 * Polling helpers over the MCP client's `listRuns`. `RunSummary` is the minimal shape these helpers need;
 * Wave 2 maps W1-A's `listRuns` result (HCP Terraform run objects) onto it with `toRunLister`.
 */
export interface RunSummary {
  id: string;
  status: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface RunLister {
  listRuns(opts?: { status?: string; pageSize?: number }): Promise<RunSummary[]>;
}

/** HCP Terraform run statuses after which a run never changes again. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'applied',
  'planned_and_finished',
  'planned_and_saved',
  'errored',
  'discarded',
  'canceled',
  'force_canceled',
  'policy_soft_failed',
]);

export class RunWatchTimeoutError extends Error {
  constructor(afterRunId: string, timeoutMs: number) {
    super(`No terminal run after ${afterRunId} within ${timeoutMs}ms`);
    this.name = 'RunWatchTimeoutError';
  }
}

export interface WatchOptions {
  afterRunId: string;
  timeoutMs: number;
  pollMs: number;
  pageSize?: number;
  signal?: AbortSignal;
}

const byCreated = (a: RunSummary, b: RunSummary) => Date.parse(a.createdAt) - Date.parse(b.createdAt);

/**
 * Resolves with the first run created after `afterRunId` once it reaches a terminal status (it does not skip
 * ahead to a later run). "After" uses `afterRunId`'s `createdAt` when it appears in a listing; until then,
 * any run absent from the first listing counts as new. Rejects with `RunWatchTimeoutError` on timeout.
 */
export async function watchForNextRun(
  mcp: RunLister,
  opts: WatchOptions,
): Promise<{ runId: string; status: string }> {
  const deadline = Date.now() + opts.timeoutMs;
  let anchor: number | undefined;
  let baseline: Set<string> | undefined;
  for (;;) {
    opts.signal?.throwIfAborted();
    const runs = await mcp.listRuns({ pageSize: opts.pageSize ?? 20 });
    const after = runs.find((r) => r.id === opts.afterRunId);
    if (after && anchor === undefined) anchor = Date.parse(after.createdAt);
    baseline ??= new Set(runs.map((r) => r.id));
    const seenBaseline = baseline;
    const newer = runs
      .filter((r) => r.id !== opts.afterRunId)
      .filter((r) => (anchor !== undefined ? Date.parse(r.createdAt) > anchor : !seenBaseline.has(r.id)))
      .sort(byCreated);
    const next = newer[0];
    if (next && TERMINAL_RUN_STATUSES.has(next.status)) return { runId: next.id, status: next.status };
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new RunWatchTimeoutError(opts.afterRunId, opts.timeoutMs);
    await sleep(Math.min(opts.pollMs, remaining), opts.signal);
  }
}

/**
 * One poller tick: errored runs created at or after `since` that are not in `seen`, oldest first.
 * Adds the returned ids to `seen`.
 */
export async function pollErroredRuns(
  mcp: RunLister,
  opts: { since: Date | string; seen: Set<string>; pageSize?: number },
): Promise<string[]> {
  const since = typeof opts.since === 'string' ? Date.parse(opts.since) : opts.since.getTime();
  const runs = await mcp.listRuns({ status: 'errored', pageSize: opts.pageSize ?? 20 });
  const fresh = runs
    .filter((r) => r.status === 'errored' && Date.parse(r.createdAt) >= since && !opts.seen.has(r.id))
    .sort(byCreated)
    .map((r) => r.id);
  for (const id of fresh) opts.seen.add(id);
  return fresh;
}

/** Adapts any `listRuns` returning raw items (e.g. JSON:API run objects) to a `RunLister`. */
export function toRunLister<T>(
  source: { listRuns(opts?: { status?: string; pageSize?: number }): Promise<T[]> },
  map: (item: T) => RunSummary,
): RunLister {
  return { listRuns: async (opts) => (await source.listRuns(opts)).map(map) };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
