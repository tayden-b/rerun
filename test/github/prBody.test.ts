import { describe, expect, it } from 'vitest';
import { renderPrBody, type PrBodyInput } from '../../src/github/prBody';
import { GENERIC_PASS } from '../../src/verify/fake';

const input: PrBodyInput = {
  triage: {
    failureClass: {
      choice: 'config_reference',
      confidence: 0.91,
      probabilities: { config_reference: 0.91, config_syntax: 0.06, missing_input: 0.02, unknown: 0.01 },
    },
    configFixable: { noul: 0.94 },
    blastRadius: {
      score: 1,
      confidence: 0.8,
      probabilities: { '1': 0.8, '2': 0.2 },
      legend: { '1': 'one resource', '2': 'a module' },
    },
    needsHuman: { noul: 0.08 },
    stage: 'plan',
    errorExcerpt: 'Error: Reference to undeclared resource\n\n  on main.tf line 40: random_pet.clustr.id',
    provider: 'jev',
    inputTokens: 1200,
    latencyMs: 900,
  },
  diagnoses: [
    {
      agent: 'config',
      rootCause:
        'main.tf references random_pet.clustr, which is not declared; the resource is random_pet.cluster.',
      evidence: [
        {
          kind: 'log',
          ref: 'plan log line 12',
          excerpt: 'A managed resource "random_pet" "clustr" has not been declared',
        },
      ],
      suggestedChange: 'Rename the reference to random_pet.cluster.',
      confidence: 0.95,
      steps: 4,
    },
  ],
  patch: {
    title: 'Fix undeclared reference to random_pet.clustr',
    summary: 'Point the certificate subject at the declared `random_pet.cluster` resource.',
    files: [{ path: 'main.tf', before: 'a', after: 'b', rationale: 'Typo | clustr → cluster' }],
  },
  verify: {
    ...GENERIC_PASS,
    plan: { ...GENERIC_PASS.plan, stdout: 'Plan: 0 to add, 1 to change, 0 to destroy.\n```' },
  },
  runUrl: 'https://app.terraform.io/app/org/workspaces/rerun-fixtures/runs/run-abc123',
  incidentUrl: 'http://localhost:3000/incidents/inc-1',
};

describe('renderPrBody', () => {
  it('renders the evidence template', () => {
    expect(renderPrBody(input)).toMatchSnapshot();
  });

  it('collapses verifier output, escapes table cells and redacts tokens', () => {
    const token = `ghp_${'b'.repeat(36)}`;
    const body = renderPrBody({
      ...input,
      verify: { ...input.verify, plan: { ...input.verify.plan, stderr: token } },
    });
    expect(body).toContain('<details>');
    expect(body).toContain('Typo \\| clustr');
    expect(body).toContain('````text');
    expect(body).not.toContain(token);
  });
});
