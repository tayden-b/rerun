/** Outcome of one live end-to-end scenario (SPEC §8.4): break → errored run → Rerun → PR. */
export interface LiveScenarioResult {
  /** Final incident status reached (`awaiting_approval`, `needs_human`, `failed`, …). */
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

/** Wave 2 (W2-L) replaces this body; the harness, schema and README table already handle its result. */
export const runLiveScenario: RunLiveScenario = async () => {
  throw new NotImplemented('wired in Wave 2 integration');
};
