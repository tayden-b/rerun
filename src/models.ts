import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { config, requireLive } from './config';

// Model ids are plain strings from config; swapping to the AI Gateway later means
// returning `gateway(id)` (or the bare id string) here instead of the Anthropic provider.
// Live only: demo mode uses recorded/fake providers and must never reach a real model.
function provider() {
  return createAnthropic({ apiKey: requireLive(['anthropic']).anthropicApiKey });
}

export function agentModel(): LanguageModel {
  return provider()(config.models.agent);
}

export function fastModel(): LanguageModel {
  return provider()(config.models.fast);
}
