import { describe, expect, it } from 'vitest';
import { estimateCostUsd, jevCostUsd, PRICES_AS_OF, summarizeIncidentCost } from '../../src/telemetry/cost';

describe('cost', () => {
  it('prices Jev input tokens at $0.042/Mtok', () => {
    expect(jevCostUsd(1_000_000)).toBeCloseTo(0.042, 12);
    expect(jevCostUsd(0)).toBe(0);
  });

  it('prices Anthropic models from the dated table', () => {
    expect(
      estimateCostUsd({ model: 'claude-haiku-5-5', inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.6, 12);
    expect(
      estimateCostUsd({ model: 'claude-sonnet-5-5', inputTokens: 500_000, outputTokens: 100_000 }),
    ).toBeCloseTo(2, 12);
    expect(
      estimateCostUsd({ model: 'claude-sonnet-5-5-20261101', inputTokens: 500_000, outputTokens: 100_000 }),
    ).toBeCloseTo(2, 12);
    expect(estimateCostUsd({ model: 'unknown-model', inputTokens: 10, outputTokens: 10 })).toBe(0);
    expect(
      estimateCostUsd({ model: 'claude-sonnet-5-5 · replay', inputTokens: 500_000, outputTokens: 100_000 }),
    ).toBeCloseTo(2, 12);
    expect(estimateCostUsd({ model: 'claude-sonnet-5-5-preview', inputTokens: 10, outputTokens: 10 })).toBe(
      0,
    );
    expect(PRICES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('summarizes an incident across decisions and agent calls', () => {
    const c = summarizeIncidentCost(
      [
        { provider: 'jev', inputTokens: 2_000_000 },
        { provider: 'recorded', inputTokens: 5_000 },
        { provider: 'llm', inputTokens: 1_000_000, model: 'claude-haiku-5-5' },
      ],
      [
        { model: 'claude-sonnet-5-5', inputTokens: 1_000_000, outputTokens: 100_000 },
        { model: 'claude-haiku-5-5', inputTokens: 0, outputTokens: 1_000_000 },
        { model: 'mystery', inputTokens: 1, outputTokens: 1 },
      ],
    );
    expect(c.jev).toEqual({ inputTokens: 2_000_000, costUsd: expect.closeTo(0.084, 12) });
    expect(c.models.map((m) => [m.model, m.inputTokens, m.outputTokens])).toEqual([
      ['claude-haiku-5-5', 1_000_000, 1_000_000],
      ['claude-sonnet-5-5', 1_000_000, 100_000],
      ['mystery', 1, 1],
    ]);
    expect(c.unpricedModels).toEqual(['mystery']);
    expect(c.totalUsd).toBeCloseTo(0.084 + 0.6 + 3, 12);
  });
});
