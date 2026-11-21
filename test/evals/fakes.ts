import path from 'node:path';
import type { DecisionProvider } from '../../src/shared/types';

export const TEST_SCENARIOS_DIR = path.join(import.meta.dirname, 'fixtures', 'scenarios');

/** Provider that answers from the state it is given: `apply_runtime` iff the excerpt mentions local-exec. */
export function keywordProvider(
  name: DecisionProvider['name'] = 'llm',
): DecisionProvider & { states: unknown[] } {
  const states: unknown[] = [];
  return {
    name,
    states,
    async decide(state) {
      states.push(state);
      const excerpt = String((state as { errorExcerpt?: string }).errorExcerpt ?? '');
      const choice = excerpt.includes('local-exec') ? 'apply_runtime' : 'config_reference';
      return {
        answers: {
          failure_class: { choice, confidence: 0.9, probabilities: { [choice]: 0.9, unknown: 0.1 } },
          config_fixable: { noul: 0.85 },
          blast_radius: { score: 0.2, confidence: 0.8, probabilities: { '0': 0.8, '1': 0.2 }, legend: {} },
          needs_human: { noul: 0.1 },
        },
        inputTokens: 1000,
        latencyMs: 50,
      };
    },
  };
}

/** Provider whose verdict depends on exact text, so any perturbation flips it. */
export function brittleProvider(): DecisionProvider {
  const inner = keywordProvider('jev');
  return {
    name: 'jev',
    async decide(state, questions) {
      const out = await inner.decide(state, questions);
      const excerpt = String((state as { errorExcerpt?: string }).errorExcerpt ?? '');
      if (excerpt.includes('request-id')) out.answers.config_fixable = { noul: 0.1 };
      return out;
    },
  };
}

export const sampleState = {
  runStatus: 'errored',
  stage: 'apply',
  errorExcerpt: [
    'terraform_data.bootstrap: Creating...',
    "terraform_data.bootstrap: Provisioning with 'local-exec'...",
    '│ Error: local-exec provisioner error',
    '│   with terraform_data.bootstrap,',
    '│   on main.tf line 58, in resource "terraform_data" "bootstrap":',
    '│   input = random_pet.service.id',
  ].join('\n'),
  planSummary: {
    counts: { create: 1, 'no-op': 2 },
    resources: [
      { address: 'terraform_data.bootstrap', actions: ['create'] },
      { address: 'random_pet.service', actions: ['no-op'] },
      { address: 'tls_private_key.ca', actions: ['no-op'] },
    ],
  },
  changedFiles: ['main.tf', 'variables.tf'],
};
