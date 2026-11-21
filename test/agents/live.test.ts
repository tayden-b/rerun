import { writeFileSync } from 'node:fs';
import { createAnthropic } from '@ai-sdk/anthropic';
import { describe, expect, it } from 'vitest';
import { runDiagnosis } from '../../src/agents/diagnose';
import { runFix } from '../../src/agents/fix';
import type { AgentEvent } from '../../src/agents/runtime';
import { DEFAULT_MODELS } from '../../src/config';
import { fakeContext, fakeMcpTools, UNDECLARED_REFERENCE_FILES } from './fakes';

// Opt-in: RERUN_LIVE_TESTS=1 plus an Anthropic key (never in CI).
const apiKey =
  process.env.RERUN_LIVE_TESTS === '1'
    ? (process.env.ANTHROPIC_API_KEY ?? process.env.RERUN_ANTHROPIC_API_KEY)
    : undefined;

function summarize(events: AgentEvent[]) {
  const done = events.filter((e) => (e.payload as { done?: boolean })?.done);
  return {
    tools: events.filter((e) => e.kind === 'tool_call').map((e) => `${e.step} ${e.title}`),
    runs: done.map((e) => ({ step: e.step, ...(e.payload as object) })),
  };
}

describe.runIf(apiKey)('live agents (undeclared-reference)', () => {
  const model = createAnthropic({ apiKey })(process.env.RERUN_MODEL_AGENT ?? DEFAULT_MODELS.agent);

  it('Config names outputs.tf and Fix removes the bad reference', { timeout: 300_000 }, async () => {
    const events: AgentEvent[] = [];
    const deps = {
      model,
      files: UNDECLARED_REFERENCE_FILES,
      mcpTools: fakeMcpTools(),
      emit: (e: AgentEvent) => void events.push(e),
    };
    const ctx = fakeContext();

    const [diagnosis] = await runDiagnosis(ctx, ['config'], deps);
    expect(diagnosis.confidence).toBeGreaterThan(0.5);
    expect(diagnosis.rootCause).toContain('outputs.tf');
    expect(diagnosis.evidence.some((e) => e.kind === 'file' && e.ref.startsWith('outputs.tf'))).toBe(true);

    const patch = await runFix(ctx, [diagnosis], deps);
    expect(patch.files.map((f) => f.path)).toEqual(['outputs.tf']);
    expect(patch.files[0].after).not.toContain('random_pet.servce');
    expect(patch.files[0].after).toContain('random_pet.service.id');
    expect(patch.files[0].rationale.length).toBeGreaterThan(0);
    expect(patch.title.length).toBeLessThanOrEqual(70);

    const transcript = process.env.RERUN_LIVE_TRANSCRIPT;
    if (transcript)
      writeFileSync(transcript, JSON.stringify({ diagnosis, patch, ...summarize(events) }, null, 2));
  });
});
