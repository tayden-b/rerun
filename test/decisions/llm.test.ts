import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { triage } from '../../src/agents/triage';
import { LlmDecisionProvider, normaliseProbabilities, toAnswers } from '../../src/decisions/llm';
import { FAILURE_CLASSES, TRIAGE_QUESTIONS } from '../../src/decisions/questions';
import { sampleContext } from './fixtures';

function mockModel(output: unknown, inputTokens = 900) {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage: {
        inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 80, text: 80, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

const unnormalised = {
  answers: {
    failure_class: {
      probabilities: {
        ...Object.fromEntries(FAILURE_CLASSES.map((c) => [c, 0])),
        apply_runtime: 3,
        unknown: 1,
      },
    },
    config_fixable: { noul: 1.4 },
    blast_radius: { probabilities: { '0': 2, '1': 2, '2': 0, '3': 0 } },
    needs_human: { noul: 0.25 },
  },
};

describe('normaliseProbabilities', () => {
  it('clamps and rescales to sum 1', () => {
    expect(normaliseProbabilities({ a: 2, b: 2, c: -1 })).toEqual({ a: 0.5, b: 0.5, c: 0 });
    expect(normaliseProbabilities({ a: 0, b: 0 })).toEqual({ a: 0.5, b: 0.5 });
    expect(normaliseProbabilities({ a: Number.NaN, b: 1 })).toEqual({ a: 0, b: 1 });
  });
});

describe('LlmDecisionProvider', () => {
  it('forces the Jev answer shapes with normalised probabilities', async () => {
    const model = mockModel(unnormalised);
    const { result } = await triage(sampleContext(), new LlmDecisionProvider({ model }));

    expect(result.provider).toBe('llm');
    expect(result.inputTokens).toBe(900);
    expect(result.failureClass.choice).toBe('apply_runtime');
    expect(result.failureClass.confidence).toBeCloseTo(0.75);
    const sum = Object.values(result.failureClass.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
    expect(Object.keys(result.failureClass.probabilities)).toEqual(FAILURE_CLASSES);
    expect(result.configFixable.noul).toBe(1);
    expect(result.blastRadius).toMatchObject({ score: 0.5, confidence: 0.5 });
    expect(result.blastRadius.legend['3']).toBe('Data-bearing or network-critical resources are destroyed');
    expect(result.needsHuman.noul).toBe(0.25);

    const call = model.doGenerateCalls[0];
    expect(call.responseFormat).toMatchObject({ type: 'json' });
    const schema = (call.responseFormat as { schema: { properties: Record<string, unknown> } }).schema;
    expect(Object.keys((schema.properties.answers as { properties: object }).properties)).toEqual(
      Object.keys(TRIAGE_QUESTIONS),
    );
  });

  it('rejects output that does not match the schema', async () => {
    const provider = new LlmDecisionProvider({ model: mockModel({ answers: { failure_class: {} } }) });
    await expect(provider.decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/LLM decision failed/);
  });

  it('fills missing options with zero before normalising', () => {
    const answers = toAnswers(
      { q: { probabilities: { a: 1 } } },
      {
        q: { type: 'choice', instructions: 'x', criteria: { a: 'A', b: 'B' } },
      },
    );
    expect(answers.q).toEqual({ choice: 'a', confidence: 1, probabilities: { a: 1, b: 0 } });
  });

  it('needs an Anthropic key in live mode when no model is passed', async () => {
    await expect(new LlmDecisionProvider().decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/RERUN_MODE=live/);
  });
});
