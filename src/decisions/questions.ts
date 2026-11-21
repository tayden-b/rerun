import type { ChoiceAnswer, DecisionQuestion, FailureClass, NoulAnswer, ScoreAnswer } from '../shared/types';

/** One-line definitions sent as the `failure_class` choice criteria (SPEC §3, §4). */
export const FAILURE_CLASS_DEFINITIONS: Record<FailureClass, string> = {
  config_syntax:
    'The configuration is malformed or uses an argument or block incorrectly: invalid HCL, a missing required argument, or an argument the provider does not support.',
  config_reference:
    'The configuration refers to something that is not declared: an undeclared resource, data source, variable, local, module or output.',
  missing_input: 'A required input variable has no value in the workspace, a tfvars file, or a default.',
  provider_version:
    'Provider or Terraform version constraints cannot be satisfied, or the lock file conflicts with them, during init.',
  provider_auth:
    'The provider rejected or lacked credentials, or the identity lacks permission for the operation.',
  provider_api_error:
    'A provider call to an external API or endpoint failed: network error, unresolvable host, timeout, rate limit, or an unexpected API response.',
  apply_runtime:
    'The plan succeeded but applying it failed at runtime, for example a provisioner or local command exiting non-zero.',
  precondition_failed:
    'A precondition, postcondition, check block, or variable validation rule evaluated to false.',
  module_source: 'A module source or version cannot be found, downloaded, or resolved during init.',
  dependency_cycle: 'The resource graph contains a cycle, so Terraform cannot order the operations.',
  drift:
    'Real infrastructure changed outside Terraform and no longer matches state, and that difference causes the failure.',
  unknown: 'None of the other classes clearly applies.',
};

export const FAILURE_CLASSES = Object.keys(FAILURE_CLASS_DEFINITIONS) as FailureClass[];

export function isFailureClass(value: string): value is FailureClass {
  return Object.hasOwn(FAILURE_CLASS_DEFINITIONS, value);
}

export const BLAST_RADIUS_LEVELS = [
  'Nothing is destroyed or replaced',
  'Only stateless or trivially recreatable resources',
  'Stateful or shared resources are replaced',
  'Data-bearing or network-critical resources are destroyed',
] as const;

/** The single triage request of SPEC §4: four questions answered in one call. */
export const TRIAGE_QUESTIONS = {
  failure_class: {
    type: 'choice',
    instructions: 'Which class best describes why this Terraform run failed?',
    criteria: FAILURE_CLASS_DEFINITIONS,
  },
  config_fixable: {
    type: 'noul',
    instructions:
      'Can this failure be fixed by changing only the Terraform configuration files, without new credentials, quota, or changes to external systems?',
  },
  blast_radius: {
    type: 'score',
    instructions:
      'How much existing infrastructure would the failing change destroy or replace if it were applied as planned?',
    criteria: [...BLAST_RADIUS_LEVELS],
  },
  needs_human: {
    type: 'noul',
    instructions:
      'Does fixing this safely require a human decision (ambiguous intent, security-sensitive change, or more than one reasonable fix)?',
  },
} satisfies Record<string, DecisionQuestion>;

export type Answer = ChoiceAnswer | NoulAnswer | ScoreAnswer;

export function isChoiceAnswer(a: Answer | undefined): a is ChoiceAnswer {
  return typeof a === 'object' && a !== null && 'choice' in a;
}

export function isNoulAnswer(a: Answer | undefined): a is NoulAnswer {
  return typeof a === 'object' && a !== null && 'noul' in a;
}

export function isScoreAnswer(a: Answer | undefined): a is ScoreAnswer {
  return typeof a === 'object' && a !== null && 'score' in a;
}
