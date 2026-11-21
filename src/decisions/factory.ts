import { config as defaultConfig, type Config } from '../config';
import type { DecisionProvider } from '../shared/types';
import { JevDecisionProvider } from './jev';
import { LlmDecisionProvider } from './llm';
import { recordDecision, RecordedDecisionProvider } from './recorded';

let warnedLlmFallback = false;

export interface CreateDecisionProviderOptions {
  /** Recorded scenario in demo mode; with `RERUN_RECORD=1` in live mode, the scenario to record into. */
  scenario?: string;
}

/** demo → recorded; live with `JEV_API_KEY` → Jev; otherwise the LLM fallback (warns once). */
export function createDecisionProvider(
  config: Config = defaultConfig,
  opts: CreateDecisionProviderOptions = {},
): DecisionProvider {
  if (config.mode === 'demo') return new RecordedDecisionProvider({ scenario: opts.scenario });
  let provider: DecisionProvider;
  if (config.jevApiKey) {
    provider = new JevDecisionProvider({ apiKey: config.jevApiKey });
  } else {
    if (!warnedLlmFallback) {
      warnedLlmFallback = true;
      console.warn('JEV_API_KEY is not set; triage decisions fall back to LlmDecisionProvider (Claude).');
    }
    provider = new LlmDecisionProvider();
  }
  return opts.scenario ? recordDecision(provider, { scenario: opts.scenario }) : provider;
}
