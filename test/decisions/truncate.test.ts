import { describe, expect, it } from 'vitest';
import { DecisionError } from '../../src/decisions/errors';
import { buildJevRequest } from '../../src/decisions/jev';
import { TRIAGE_QUESTIONS } from '../../src/decisions/questions';
import {
  estimateTokens,
  JEV_QUESTION_TOKEN_LIMIT,
  MIN_EXCERPT_CHARS,
  stateTokenBudget,
  truncateState,
} from '../../src/decisions/truncate';

function state(excerptChars: number, changes: number) {
  return {
    runStatus: 'errored',
    stage: 'plan',
    errorExcerpt: `Error: start\n${'x'.repeat(excerptChars)}\nError: end`,
    planSummary: {
      total: changes,
      counts: { create: changes },
      changes: Array.from({ length: changes }, (_, i) => ({
        address: `null_resource.r${i}`,
        action: 'create',
      })),
      omitted: 0,
    },
    changedFiles: [],
  };
}

describe('truncateState', () => {
  it('returns a state within budget unchanged', () => {
    const s = state(100, 3);
    expect(truncateState(s, 10_000)).toBe(s);
  });

  it('trims errorExcerpt first, keeping its head and tail', () => {
    const s = state(200_000, 30);
    const out = truncateState(s, 30_000);
    expect(estimateTokens(out)).toBeLessThanOrEqual(30_000);
    expect(out.planSummary).toEqual(s.planSummary);
    expect(out.errorExcerpt.startsWith('Error: start')).toBe(true);
    expect(out.errorExcerpt.endsWith('Error: end')).toBe(true);
    expect(out.errorExcerpt).toMatch(/\[truncated \d+ chars\]/);
  });

  it('then drops planSummary entries once the excerpt is at its floor', () => {
    const s = state(50_000, 3_000);
    const budget = 5_000;
    const out = truncateState(s, budget);
    expect(estimateTokens(out)).toBeLessThanOrEqual(budget);
    expect(out.errorExcerpt.length).toBe(MIN_EXCERPT_CHARS);
    expect(out.planSummary.changes.length).toBeLessThan(3_000);
    expect(out.planSummary.changes.length).toBeGreaterThan(0);
    expect(out.planSummary.omitted).toBe(3_000 - out.planSummary.changes.length);
    expect(out.planSummary.changes[0].address).toBe('null_resource.r0');
  });

  it('throws DecisionError when nothing truncatable is left', () => {
    const s = {
      ...state(10, 0),
      changedFiles: Array.from({ length: 5_000 }, (_, i) => `modules/m${i}/main.tf`),
    };
    expect(() => truncateState(s, 1_000)).toThrow(DecisionError);
  });

  it('keeps the Jev request within the 32k per-question limit', () => {
    const body = buildJevRequest(state(500_000, 30), TRIAGE_QUESTIONS);
    const largestQuestion = Math.max(...Object.values(body.questions).map(estimateTokens));
    expect(estimateTokens(body.state) + largestQuestion).toBeLessThanOrEqual(JEV_QUESTION_TOKEN_LIMIT);
    expect(estimateTokens(body.state)).toBeLessThanOrEqual(stateTokenBudget(TRIAGE_QUESTIONS));
  });
});
