import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { config } from './config';

// Model ids are plain strings from config; swapping to the AI Gateway later means
// returning `gateway(id)` (or the bare id string) here instead of the Anthropic provider.
function provider() {
  return createAnthropic({ apiKey: config.anthropicApiKey });
}

export function agentModel(): LanguageModel {
  return provider()(config.models.agent);
}

export function fastModel(): LanguageModel {
  return provider()(config.models.fast);
}
