import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { describe, expect, it } from 'vitest';
import { triage } from '../../src/agents/triage';
import { DEFAULT_MODELS } from '../../src/config';
import { JevDecisionProvider } from '../../src/decisions/jev';
import { LlmDecisionProvider } from '../../src/decisions/llm';
import { isFailureClass } from '../../src/decisions/questions';
import type { DecisionProvider } from '../../src/shared/types';
import { sampleContext } from './fixtures';

// Live checks against the real APIs. They run only when the key is in the environment
// (never in GitHub CI) and use the inline sample state, which mirrors apply-time-exit-1.
const jevKey = process.env.JEV_API_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.RERUN_ANTHROPIC_API_KEY;
const fastModelId = process.env.RERUN_MODEL_FAST ?? DEFAULT_MODELS.fast;

async function expectValidTriage(provider: DecisionProvider) {
  const { result } = await triage(sampleContext(), provider);
  expect(isFailureClass(result.failureClass.choice)).toBe(true);
  expect(result.configFixable.noul).toBeGreaterThanOrEqual(0);
  expect(result.needsHuman.noul).toBeLessThanOrEqual(1);
  expect(result.blastRadius.legend).toHaveProperty('3');
  expect(result.inputTokens).toBeGreaterThan(0);
}

describe('live decision providers', () => {
  it.runIf(Boolean(jevKey))(
    'Jev answers the four triage questions',
    () => expectValidTriage(new JevDecisionProvider({ apiKey: jevKey })),
    60_000,
  );

  it.runIf(Boolean(anthropicKey))(
    'the LLM provider answers the four triage questions',
    () =>
      expectValidTriage(
        new LlmDecisionProvider({ model: createAnthropic({ apiKey: anthropicKey })(fastModelId) }),
      ),
    60_000,
  );

  it('the sample state mirrors the apply-time-exit-1 scenario', () => {
    const logs = JSON.parse(
      readFileSync(
        path.join('fixtures', 'scenarios', 'apply-time-exit-1', 'mcp', 'get_apply_logs.json'),
        'utf8',
      ),
    ).result as string;
    expect(logs).toContain('local-exec provisioner error');
    expect(sampleContext().artifacts.errorExcerpt).toContain('local-exec provisioner error');
  });
});
