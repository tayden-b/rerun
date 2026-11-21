import { describe, expect, it } from 'vitest';
import { triage } from '../../src/agents/triage';
import { loadConfig, requireLive } from '../../src/config';
import { JevDecisionProvider } from '../../src/decisions/jev';
import { LlmDecisionProvider } from '../../src/decisions/llm';
import { isFailureClass } from '../../src/decisions/questions';
import type { DecisionProvider } from '../../src/shared/types';
import { sampleContext } from './fixtures';

// Real API calls with the inline sample state (mirrors apply-time-exit-1). `requireLive`
// fails with the missing variable's name when a key is absent.
async function expectValidTriage(provider: DecisionProvider) {
  const { result } = await triage(sampleContext(), provider);
  expect(isFailureClass(result.failureClass.choice)).toBe(true);
  expect(result.configFixable.noul).toBeGreaterThanOrEqual(0);
  expect(result.needsHuman.noul).toBeLessThanOrEqual(1);
  expect(result.blastRadius.legend).toHaveProperty('3');
  expect(result.inputTokens).toBeGreaterThan(0);
}

describe('live decision providers', () => {
  it('Jev answers the four triage questions', async () => {
    const config = requireLive(['jev'], loadConfig());
    await expectValidTriage(new JevDecisionProvider({ apiKey: config.jevApiKey }));
  }, 60_000);

  it('the LLM provider answers the four triage questions', async () => {
    const config = requireLive(['anthropic'], loadConfig());
    await expectValidTriage(new LlmDecisionProvider({ config }));
  }, 60_000);
});
