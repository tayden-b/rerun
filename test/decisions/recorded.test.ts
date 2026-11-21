import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triage } from '../../src/agents/triage';
import { loadConfig } from '../../src/config';
import { createDecisionProvider } from '../../src/decisions/factory';
import { JevDecisionProvider } from '../../src/decisions/jev';
import { LlmDecisionProvider } from '../../src/decisions/llm';
import { TRIAGE_QUESTIONS } from '../../src/decisions/questions';
import {
  recordDecision,
  RecordedDecisionProvider,
  recordedDecisionSchema,
  SCENARIOS_DIR,
} from '../../src/decisions/recorded';
import { route } from '../../src/decisions/routing';
import type { DecisionProvider } from '../../src/shared/types';
import { LEGEND, sampleContext } from './fixtures';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rerun-decisions-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const answers = {
  failure_class: {
    choice: 'config_reference',
    confidence: 0.9,
    probabilities: { config_reference: 0.9, unknown: 0.1 },
  },
  config_fixable: { noul: 0.9 },
  blast_radius: {
    score: 0.1,
    confidence: 0.9,
    probabilities: { '0': 0.9, '1': 0.1, '2': 0, '3': 0 },
    legend: LEGEND,
  },
  needs_human: { noul: 0.1 },
};

const fakeLive: DecisionProvider = {
  name: 'jev',
  decide: async () => ({ answers, inputTokens: 700, latencyMs: 90 }),
};

describe('recordDecision + RecordedDecisionProvider', () => {
  it('writes jev.json when recording and replays it', async () => {
    const recorder = recordDecision(fakeLive, {
      scenario: 'inline-scenario',
      scenariosDir: dir,
      enabled: true,
    });
    await recorder.decide('state', TRIAGE_QUESTIONS);

    const written = recordedDecisionSchema.parse(
      JSON.parse(await readFile(path.join(dir, 'inline-scenario', 'jev.json'), 'utf8')),
    );
    expect(written).toMatchObject({ provider: 'jev', inputTokens: 700, latencyMs: 90, answers });

    const replay = new RecordedDecisionProvider({ scenario: 'inline-scenario', scenariosDir: dir });
    const { result } = await triage(sampleContext({ stage: 'plan' }), replay);
    expect(result).toMatchObject({
      provider: 'recorded',
      failureClass: { choice: 'config_reference' },
      stage: 'plan',
      inputTokens: 700,
    });
  });

  it('is a pass-through unless RERUN_RECORD=1', () => {
    expect(recordDecision(fakeLive, { scenario: 'x', scenariosDir: dir })).toBe(fakeLive);
  });

  it('throws DecisionError for a missing scenario or a missing answer', async () => {
    const missing = new RecordedDecisionProvider({ scenario: 'nope', scenariosDir: dir });
    await expect(missing.decide('s', TRIAGE_QUESTIONS)).rejects.toThrow(/No recorded decision/);

    await recordDecision(fakeLive, { scenario: 'partial', scenariosDir: dir, enabled: true }).decide('s', {});
    const partial = new RecordedDecisionProvider({ scenario: 'partial', scenariosDir: dir });
    await expect(partial.decide('s', { extra: { type: 'noul', instructions: 'x' } })).rejects.toThrow(
      /no noul answer for "extra"/,
    );
  });

  it('rejects scenario names that escape the fixtures directory', async () => {
    await expect(new RecordedDecisionProvider({ scenario: '../etc' }).decide('s', {})).rejects.toThrow(
      /Invalid scenario name/,
    );
  });
});

describe('placeholder jev.json fixtures', () => {
  it.each([
    ['apply-time-exit-1', 'apply_runtime'],
    ['undeclared-reference', 'config_reference'],
  ])('%s replays as %s and routes to autoPr', async (scenario, cls) => {
    const raw = recordedDecisionSchema.parse(
      JSON.parse(await readFile(path.join(SCENARIOS_DIR, scenario, 'jev.json'), 'utf8')),
    );
    expect(raw.placeholder).toBe(true);
    const { result } = await triage(sampleContext(), new RecordedDecisionProvider({ scenario }));
    expect(result.failureClass.choice).toBe(cls);
    const sum = Object.values(result.failureClass.probabilities).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
    expect(route(result)).toBe('autoPr');
  });
});

describe('createDecisionProvider', () => {
  it('uses the recorded provider in demo mode', () => {
    expect(createDecisionProvider(loadConfig({ RERUN_MODE: 'demo' }))).toBeInstanceOf(
      RecordedDecisionProvider,
    );
  });

  it('uses Jev in live mode when JEV_API_KEY is set', () => {
    const p = createDecisionProvider(loadConfig({ RERUN_MODE: 'live', JEV_API_KEY: 'k' }));
    expect(p).toBeInstanceOf(JevDecisionProvider);
  });

  it('falls back to the LLM provider and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const live = loadConfig({ RERUN_MODE: 'live' });
    expect(createDecisionProvider(live)).toBeInstanceOf(LlmDecisionProvider);
    expect(createDecisionProvider(live)).toBeInstanceOf(LlmDecisionProvider);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
