import type { IncidentContext } from '../../src/shared/types';

export const SAMPLE_EXCERPT = [
  '│ Error: local-exec provisioner error',
  '│',
  '│   with terraform_data.bootstrap,',
  '│   on main.tf line 58, in resource "terraform_data" "bootstrap":',
  '│   58:   provisioner "local-exec" {',
  '│',
  "│ Error running command 'echo bootstrapping && exit 1': exit status 1. Output: bootstrapping",
].join('\n');

export const SAMPLE_RUN = {
  result: {
    id: 'run-TEST0001',
    type: 'runs',
    attributes: { status: 'errored', message: 'scenario: test' },
    relationships: { 'configuration-version': { data: { id: 'cv-TEST01', type: 'configuration-versions' } } },
  },
};

export const SAMPLE_PLAN = {
  result: {
    format_version: '1.2',
    resource_changes: [
      { address: 'terraform_data.bootstrap', change: { actions: ['create'] } },
      { address: 'random_pet.service', change: { actions: ['no-op'] } },
      { address: 'tls_private_key.ca', change: { actions: ['delete', 'create'] } },
      { address: 'null_resource.old', change: { actions: ['delete'] } },
    ],
  },
};

export function sampleContext(overrides: Partial<IncidentContext['artifacts']> = {}): IncidentContext {
  return {
    incidentId: 'inc-1',
    runId: 'run-TEST0001',
    workspace: 'rerun-fixtures',
    repo: { owner: 'tayden-b', name: 'rerun-fixtures', baseBranch: 'main', headSha: 'abc123' },
    artifacts: {
      run: SAMPLE_RUN,
      workspace: {},
      planJson: SAMPLE_PLAN,
      applyLogs: SAMPLE_EXCERPT,
      stage: 'apply',
      errorExcerpt: SAMPLE_EXCERPT,
      ...overrides,
    },
  };
}

export const LEGEND = {
  '0': 'Nothing is destroyed or replaced',
  '1': 'Only stateless or trivially recreatable resources',
  '2': 'Stateful or shared resources are replaced',
  '3': 'Data-bearing or network-critical resources are destroyed',
};

export function jevResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: 'jev-1',
    answers: {
      failure_class: {
        type: 'choice',
        choice: 'apply_runtime',
        confidence: 0.9,
        probabilities: { apply_runtime: 0.9, unknown: 0.1 },
      },
      config_fixable: { type: 'noul', noul: 0.85 },
      blast_radius: {
        type: 'score',
        score: 0.1,
        confidence: 0.9,
        probabilities: { '0': 0.9, '1': 0.1, '2': 0, '3': 0 },
        legend: LEGEND,
      },
      needs_human: { type: 'noul', noul: 0.2 },
      ...overrides,
    },
    usage: { input_tokens: 1053, output_tokens: 12 },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
