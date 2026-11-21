import { describe, expect, it } from 'vitest';
import {
  pollErroredRuns,
  RunWatchTimeoutError,
  toRunLister,
  watchForNextRun,
  type RunLister,
  type RunSummary,
} from '../../src/watch/runs';

const run = (id: string, status: string, minute: number): RunSummary => ({
  id,
  status,
  createdAt: new Date(Date.UTC(2026, 10, 21, 12, minute)).toISOString(),
});

function scripted(pages: RunSummary[][]): RunLister & { calls: { status?: string; pageSize?: number }[] } {
  const calls: { status?: string; pageSize?: number }[] = [];
  let i = 0;
  return {
    calls,
    async listRuns(opts = {}) {
      calls.push(opts);
      const page = pages[Math.min(i, pages.length - 1)];
      i += 1;
      return opts.status ? page.filter((r) => r.status === opts.status) : page;
    },
  };
}

describe('watchForNextRun', () => {
  it('resolves on the first newer run once it is terminal', async () => {
    const mcp = scripted([
      [run('run-old', 'errored', 0)],
      [run('run-new', 'planning', 5), run('run-old', 'errored', 0)],
      [run('run-new', 'applying', 5), run('run-old', 'errored', 0)],
      [run('run-new', 'applied', 5), run('run-old', 'errored', 0)],
    ]);
    const res = await watchForNextRun(mcp, { afterRunId: 'run-old', timeoutMs: 2000, pollMs: 5 });
    expect(res).toEqual({ runId: 'run-new', status: 'applied' });
    expect(mcp.calls).toHaveLength(4);
  });

  it('ignores runs older than afterRunId and waits for the earliest newer run', async () => {
    const mcp = scripted([
      [
        run('run-later', 'errored', 9),
        run('run-next', 'applying', 6),
        run('run-anchor', 'errored', 3),
        run('run-older', 'applied', 1),
      ],
      [
        run('run-later', 'errored', 9),
        run('run-next', 'errored', 6),
        run('run-anchor', 'errored', 3),
        run('run-older', 'applied', 1),
      ],
    ]);
    const res = await watchForNextRun(mcp, { afterRunId: 'run-anchor', timeoutMs: 2000, pollMs: 5 });
    expect(res).toEqual({ runId: 'run-next', status: 'errored' });
  });

  it('treats runs missing from the first listing as new when afterRunId has paged out', async () => {
    const mcp = scripted([
      [run('run-x', 'applied', 1)],
      [run('run-y', 'applied', 2), run('run-x', 'applied', 1)],
    ]);
    const res = await watchForNextRun(mcp, { afterRunId: 'run-gone', timeoutMs: 2000, pollMs: 5 });
    expect(res.runId).toBe('run-y');
  });

  it('times out cleanly', async () => {
    const mcp = scripted([[run('run-old', 'errored', 0)]]);
    const started = Date.now();
    await expect(
      watchForNextRun(mcp, { afterRunId: 'run-old', timeoutMs: 60, pollMs: 10 }),
    ).rejects.toBeInstanceOf(RunWatchTimeoutError);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('pollErroredRuns', () => {
  it('returns new errored runs since a time, oldest first, and remembers them', async () => {
    const page = [
      run('run-c', 'errored', 30),
      run('run-b', 'applied', 20),
      run('run-a', 'errored', 10),
      run('run-0', 'errored', 1),
    ];
    const mcp = scripted([page]);
    const seen = new Set<string>();
    const since = new Date(Date.UTC(2026, 10, 21, 12, 5));
    expect(await pollErroredRuns(mcp, { since, seen })).toEqual(['run-a', 'run-c']);
    expect(mcp.calls[0]).toMatchObject({ status: 'errored' });
    expect(await pollErroredRuns(mcp, { since: since.toISOString(), seen })).toEqual([]);
  });
});

describe('toRunLister', () => {
  it('maps raw run objects', async () => {
    const raw = {
      listRuns: async () => [
        { id: 'run-1', attributes: { status: 'applied', 'created-at': '2026-11-21T00:00:00Z' } },
      ],
    };
    const lister = toRunLister(raw, (r) => ({
      id: r.id,
      status: r.attributes.status,
      createdAt: r.attributes['created-at'],
    }));
    expect(await lister.listRuns()).toEqual([
      { id: 'run-1', status: 'applied', createdAt: '2026-11-21T00:00:00Z' },
    ]);
  });
});
