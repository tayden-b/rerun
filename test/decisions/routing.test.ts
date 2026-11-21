import { describe, expect, it } from 'vitest';
import {
  AUTO_PR_MAX_BLAST_RADIUS,
  AUTO_PR_MAX_NEEDS_HUMAN,
  AUTO_PR_MIN_CONFIG_FIXABLE,
  route,
  selectAgents,
} from '../../src/decisions/routing';
import type { FailureClass, Route, Stage } from '../../src/shared/types';

function triage(cls: FailureClass, fixable: number, blast: number, human: number) {
  return {
    failureClass: { choice: cls, confidence: 0.9, probabilities: { [cls]: 0.9 } },
    configFixable: { noul: fixable },
    blastRadius: { score: blast, confidence: 0.9, probabilities: {}, legend: {} },
    needsHuman: { noul: human },
  };
}

describe('route', () => {
  it('uses the SPEC §4 thresholds', () => {
    expect([AUTO_PR_MIN_CONFIG_FIXABLE, AUTO_PR_MAX_BLAST_RADIUS, AUTO_PR_MAX_NEEDS_HUMAN]).toEqual([
      0.7, 1.0, 0.4,
    ]);
  });

  const cases: [string, FailureClass, number, number, number, Route][] = [
    ['clear config fix', 'config_reference', 0.95, 0.1, 0.1, 'autoPr'],
    ['config_fixable exactly 0.70', 'config_syntax', 0.7, 0.5, 0.2, 'autoPr'],
    ['config_fixable just below 0.70', 'config_syntax', 0.6999, 0.5, 0.2, 'draftPr'],
    ['blast_radius exactly 1.0', 'apply_runtime', 0.9, 1.0, 0.2, 'autoPr'],
    ['blast_radius just above 1.0', 'apply_runtime', 0.9, 1.0001, 0.2, 'draftPr'],
    ['needs_human exactly 0.40', 'missing_input', 0.9, 0.0, 0.4, 'autoPr'],
    ['needs_human just above 0.40', 'missing_input', 0.9, 0.0, 0.4001, 'draftPr'],
    ['destructive change', 'config_syntax', 0.9, 2.6, 0.1, 'draftPr'],
    ['not config fixable', 'provider_api_error', 0.2, 0.0, 0.3, 'draftPr'],
    ['provider_auth overrides a clean triage', 'provider_auth', 0.99, 0.0, 0.0, 'draftPr'],
    ['drift overrides a clean triage', 'drift', 0.99, 0.0, 0.0, 'draftPr'],
  ];

  it.each(cases)('%s → %s', (_label, cls, fixable, blast, human, expected) => {
    expect(route(triage(cls, fixable, blast, human))).toBe(expected);
  });
});

describe('selectAgents', () => {
  const cases: [FailureClass, Stage, ('config' | 'reality')[]][] = [
    ['config_syntax', 'plan', ['config']],
    ['config_reference', 'plan', ['config']],
    ['module_source', 'init', ['config']],
    ['precondition_failed', 'plan', ['config']],
    ['config_syntax', 'apply', ['config', 'reality']],
    ['apply_runtime', 'apply', ['config', 'reality']],
    ['drift', 'plan', ['config', 'reality']],
    ['provider_api_error', 'plan', ['config', 'reality']],
    ['unknown', 'init', ['config', 'reality']],
  ];

  it.each(cases)('%s at %s → %j', (cls, stage, expected) => {
    expect(selectAgents({ ...triage(cls, 0.9, 0, 0), stage })).toEqual(expected);
  });
});
