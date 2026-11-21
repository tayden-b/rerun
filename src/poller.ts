import { config as defaultConfig, type Config } from './config';
import { incidentServices } from './incident/services';
import { startIncident } from './incident/start';
import { redact } from './shared/redact';
import { pollErroredRuns } from './watch/runs';

// SPEC §2 trigger: every RERUN_POLL_SECONDS, list errored runs on RERUN_WORKSPACE through the MCP server
// and start one incident per new run. One poller per server process (Next dev may call `register` twice).

const KEY = Symbol.for('rerun.poller');
type Store = typeof globalThis & { [KEY]?: { stop(): void } };

export interface PollerOptions {
  config?: Config;
  env?: Record<string, string | undefined>;
  /** Only runs created at or after this time start incidents (default: now; demo autoplay: all). */
  since?: Date;
  log?: (line: string) => void;
}

export function shouldPoll(config: Config, env: Record<string, string | undefined> = process.env): boolean {
  if (config.pollSeconds === 0) return false;
  return config.mode !== 'demo' || env.RERUN_DEMO_AUTOPLAY === '1';
}

/** One poll: start incidents for errored runs not seen before. Returns the run ids started. */
export async function pollOnce(seen: Set<string>, since: Date): Promise<string[]> {
  const services = incidentServices();
  const mcp = await services.mcp();
  let fresh: string[];
  try {
    fresh = await pollErroredRuns(services.runLister(mcp, ''), { since, seen });
  } finally {
    await mcp.close();
  }
  const started: string[] = [];
  for (const runId of fresh) {
    if ((await startIncident(runId)).created) started.push(runId);
  }
  return started;
}

/** Starts the poller once per process; returns a stop function (or null when polling is off). */
export function startPoller(opts: PollerOptions = {}): { stop(): void } | null {
  const config = opts.config ?? defaultConfig;
  const store = globalThis as Store;
  if (store[KEY]) return store[KEY];
  if (!shouldPoll(config, opts.env)) return null;
  const log = opts.log ?? ((line: string) => console.log(line));
  const since = opts.since ?? (config.mode === 'demo' ? new Date(0) : new Date());
  const seen = new Set<string>();
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const started = await pollOnce(seen, since);
      for (const runId of started) log(`[poller] started incident for ${runId}`);
    } catch (error) {
      log(`[poller] ${redact(error instanceof Error ? error.message : String(error))}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.pollSeconds * 1000);
  timer.unref?.();
  void tick();
  const handle = {
    stop() {
      clearInterval(timer);
      store[KEY] = undefined;
    },
  };
  store[KEY] = handle;
  return handle;
}
