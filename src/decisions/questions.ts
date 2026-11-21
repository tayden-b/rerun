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

/**
 * What Rerun can change: any `.tf`/`.tfvars` file in the repository, through a pull request that a
 * human reviews and approves before merge. It cannot supply secrets, credentials, quota or changes to
 * systems outside Terraform.
 */
export const CONFIG_FIXABLE_INSTRUCTIONS = [
  'Can this failure be fixed by editing only the Terraform files (.tf and .tfvars) in the repository?',
  'Such an edit can change any argument, reference, expression, URL, command or literal value; add or remove blocks; add variable defaults or tfvars values; and change provider or Terraform version constraints and module sources.',
  'Answer yes when the cause is something written in the configuration, including a configured value that an external endpoint, provisioner command or assertion then rejects.',
  'Answer no only when the fix needs something a file edit cannot provide: credentials or secret values, quota or permissions, or changes to systems outside Terraform.',
].join(' ');

export const BLAST_RADIUS_INSTRUCTIONS = [
  'How much existing infrastructure would the failing change destroy or replace if it were applied as planned?',
  'Judge from the plan summary: the resource actions and what each resource type holds.',
  'Creates, in-place updates and runs with no plan destroy nothing.',
  'Replacing a resource that holds no data, such as one that only runs a command or stores a generated value, is the second level, not higher.',
].join(' ');

export const NEEDS_HUMAN_INSTRUCTIONS = [
  'Does fixing this require a person to supply information or make a decision that cannot be derived from the repository, run logs, plan, state and provider documentation?',
  'Every fix is opened as a pull request that a human reviews and must approve before it merges, so needing review is not a reason to answer yes, and neither is the existence of several equivalent ways to write the fix.',
  'Answer yes for: credentials or secret values; a choice between materially different outcomes that only the owners can make; accepting the destruction or replacement of stateful data; or changes outside Terraform.',
  "A fix that edits a module block's source or version, or a required_providers or required_version constraint, counts as such a choice even when it looks like a simple correction, because it changes which dependency code the configuration installs; failures to install a module or to resolve a provider version are fixed this way.",
  'Otherwise answer no when the correct change follows from the configuration and the error, for example correcting a misspelled reference, adding a missing argument, removing an unsupported one, giving a non-secret input a default or tfvars value that the reviewer can adjust, breaking a dependency loop, or changing a configured value so that it satisfies the check, endpoint or command that rejected it.',
  "An assertion, validation rule or condition in the configuration already states the owners' intent, so meeting it is not a new decision.",
].join(' ');

/** The single triage request of SPEC §4: four questions answered in one call. */
export const TRIAGE_QUESTIONS = {
  failure_class: {
    type: 'choice',
    instructions: 'Which class best describes why this Terraform run failed?',
    criteria: FAILURE_CLASS_DEFINITIONS,
  },
  config_fixable: {
    type: 'noul',
    instructions: CONFIG_FIXABLE_INSTRUCTIONS,
  },
  blast_radius: {
    type: 'score',
    instructions: BLAST_RADIUS_INSTRUCTIONS,
    criteria: [...BLAST_RADIUS_LEVELS],
  },
  needs_human: {
    type: 'noul',
    instructions: NEEDS_HUMAN_INSTRUCTIONS,
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
