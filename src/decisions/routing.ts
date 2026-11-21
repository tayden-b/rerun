import type { FailureClass, Route, TriageResult } from '../shared/types';

/** SPEC §4 routing thresholds. */
export const AUTO_PR_MIN_CONFIG_FIXABLE = 0.7;
export const AUTO_PR_MAX_BLAST_RADIUS = 1.0;
export const AUTO_PR_MAX_NEEDS_HUMAN = 0.4;
/** Classes that need a credential or an import decision: always a draft PR. */
export const ALWAYS_DRAFT_CLASSES: readonly FailureClass[] = ['provider_auth', 'drift'];
/** Classes (besides stage `apply`) where the RealityAgent also runs. */
export const REALITY_AGENT_CLASSES: readonly FailureClass[] = [
  'drift',
  'apply_runtime',
  'provider_api_error',
  'unknown',
];

export type RoutingInput = Pick<
  TriageResult,
  'failureClass' | 'configFixable' | 'blastRadius' | 'needsHuman'
>;

export function route(triage: RoutingInput): Route {
  if (ALWAYS_DRAFT_CLASSES.includes(triage.failureClass.choice)) return 'draftPr';
  const auto =
    triage.configFixable.noul >= AUTO_PR_MIN_CONFIG_FIXABLE &&
    triage.blastRadius.score <= AUTO_PR_MAX_BLAST_RADIUS &&
    triage.needsHuman.noul <= AUTO_PR_MAX_NEEDS_HUMAN;
  return auto ? 'autoPr' : 'draftPr';
}

export function selectAgents(triage: Pick<TriageResult, 'failureClass' | 'stage'>): ('config' | 'reality')[] {
  const reality = triage.stage === 'apply' || REALITY_AGENT_CLASSES.includes(triage.failureClass.choice);
  return reality ? ['config', 'reality'] : ['config'];
}
