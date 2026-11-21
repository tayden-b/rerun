import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { RunListItem, TerraformMcp } from '../src/mcp/terraform';
import { watchForNextRun, type RunLister } from '../src/watch/runs';

const exec = promisify(execFile);

/** Statuses `reset.sh` may end in: `applied` after an apply scenario, a no-change plan otherwise. */
export const BASELINE_STATUSES = ['applied', 'planned_and_finished'];

export interface FixturesDriverOptions {
  /** Checkout of `tayden-b/rerun-fixtures` whose scripts push to `main` (default `../rerun-fixtures`). */
  dir?: string;
  mcp: () => Promise<TerraformMcp>;
  timeoutMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}

/**
 * The workspace's own runs. Speculative plans (`plan_only`: Rerun's verifier and the fixtures repo's PR
 * check) land on the same workspace, so a watcher that counted them would mistake one for the run a push
 * to `main` produced.
 */
export function workspaceRunLister(mcp: TerraformMcp): RunLister {
  return {
    listRuns: async (opts) =>
      (await mcp.listRuns(opts)).runs
        .filter((r: RunListItem) => r.plan_only !== true)
        .map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at ?? new Date(0).toISOString() })),
  };
}

/** Drives `scripts/break.sh` / `scripts/reset.sh` and waits for the HCP Terraform run each push produces. */
export function fixturesDriver(opts: FixturesDriverOptions) {
  const dir = path.resolve(opts.dir ?? path.join(process.cwd(), '..', 'rerun-fixtures'));
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000;
  const pollMs = opts.pollMs ?? 10_000;
  const log = opts.log ?? (() => {});

  async function withLister<T>(fn: (lister: RunLister) => Promise<T>): Promise<T> {
    const mcp = await opts.mcp();
    try {
      return await fn(workspaceRunLister(mcp));
    } finally {
      await mcp.close();
    }
  }

  const latestRunId = () =>
    withLister(async (lister) => {
      const runs = await lister.listRuns({ pageSize: 20 });
      return runs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]?.id ?? '';
    });

  const waitAfter = (afterRunId: string) =>
    withLister((lister) => watchForNextRun(lister, { afterRunId, timeoutMs, pollMs }));

  async function script(name: string, args: string[] = []): Promise<string> {
    // A merged Rerun PR moves `main`; the scripts refuse to run on a stale checkout.
    await exec('git', ['pull', '-q', '--ff-only', 'origin', 'main'], { cwd: dir });
    const { stdout } = await exec(path.join(dir, 'scripts', name), args, { cwd: dir });
    log(stdout.trim());
    return stdout;
  }

  return {
    /** Pushes the scenario and resolves with the `errored` run it produced. */
    async break(scenario: string): Promise<string> {
      const anchor = await latestRunId();
      await script('break.sh', [scenario]);
      const run = await waitAfter(anchor);
      if (run.status !== 'errored')
        throw new Error(`${scenario}: run ${run.runId} ended ${run.status}, not errored`);
      return run.runId;
    },
    /** Returns `main` to the baseline and waits for its run; null when it was already at baseline. */
    async reset(): Promise<{ runId: string; status: string } | null> {
      const anchor = await latestRunId();
      const out = await script('reset.sh');
      if (/Already at baseline/.test(out)) return null;
      const run = await waitAfter(anchor);
      if (!BASELINE_STATUSES.includes(run.status))
        throw new Error(`reset: run ${run.runId} ended ${run.status}`);
      return run;
    },
  };
}
