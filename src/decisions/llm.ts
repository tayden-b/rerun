import { generateText, Output, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { requireLive, type Config } from '../config';
import { fastModel } from '../models';
import type { DecisionProvider, DecisionQuestion } from '../shared/types';
import { DecisionError } from './errors';
import type { Answer } from './questions';
import { stateTokenBudget, truncateState } from './truncate';

const SYSTEM = [
  'You are a calibrated classifier for failed HCP Terraform runs.',
  'You receive the run state as JSON and a set of named questions.',
  'Answer every question with probabilities that reflect your real uncertainty: 0 means certainly no, 1 certainly yes.',
  'For choice and score questions give a probability for every option; they should sum to 1.',
  'Base your answers only on the state.',
].join(' ');

/** Drops negative/non-finite values and rescales to sum 1; falls back to uniform when nothing is positive. */
export function normaliseProbabilities(probabilities: Record<string, number>): Record<string, number> {
  const keys = Object.keys(probabilities);
  const weights = keys.map((k) => {
    const p = probabilities[k];
    return Number.isFinite(p) && p > 0 ? p : 0;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  return Object.fromEntries(keys.map((k, i) => [k, sum > 0 ? weights[i] / sum : 1 / keys.length]));
}

function clamp01(p: number): number {
  return Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5;
}

function options(q: DecisionQuestion): string[] {
  if (q.type === 'choice' && q.criteria && !Array.isArray(q.criteria)) return Object.keys(q.criteria);
  if (q.type === 'score' && Array.isArray(q.criteria)) return q.criteria.map((_, i) => String(i));
  return [];
}

function questionSchema(name: string, q: DecisionQuestion) {
  if (q.type === 'noul') {
    return z.object({
      noul: z.number().describe('Probability that the answer is yes / the statement is true, 0 to 1'),
    });
  }
  const keys = options(q);
  if (keys.length === 0)
    throw new DecisionError(`Question "${name}": ${q.type} criteria are missing or malformed`);
  const describe =
    q.type === 'score'
      ? (k: string) => `Probability of level ${k}: ${(q.criteria as string[])[Number(k)]}`
      : (k: string) => `Probability of "${k}": ${(q.criteria as Record<string, string>)[k]}`;
  return z.object({
    probabilities: z.object(Object.fromEntries(keys.map((k) => [k, z.number().describe(describe(k))]))),
  });
}

/** The zod schema the model must fill: one entry per question, shaped by question type. */
export function decisionSchema(questions: Record<string, DecisionQuestion>) {
  return z.object({
    answers: z.object(
      Object.fromEntries(Object.entries(questions).map(([n, q]) => [n, questionSchema(n, q)])),
    ),
  });
}

/** Turns the model's raw probabilities into the Jev answer shapes (normalised). */
export function toAnswers(
  raw: Record<string, { noul?: number; probabilities?: Record<string, number> }>,
  questions: Record<string, DecisionQuestion>,
): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const r = raw[name];
    if (!r) throw new DecisionError(`Model output has no answer for "${name}"`);
    if (q.type === 'noul') {
      answers[name] = { noul: clamp01(r.noul ?? NaN) };
      continue;
    }
    const keys = options(q);
    const probabilities = normaliseProbabilities(
      Object.fromEntries(keys.map((k) => [k, r.probabilities?.[k] ?? 0])),
    );
    const best = keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
    const confidence = probabilities[best];
    if (q.type === 'choice') {
      answers[name] = { choice: best, confidence, probabilities };
    } else {
      const levels = q.criteria as string[];
      const score = keys.reduce((s, k) => s + Number(k) * probabilities[k], 0);
      answers[name] = {
        score,
        confidence,
        probabilities,
        legend: Object.fromEntries(keys.map((k) => [k, levels[Number(k)]])),
      };
    }
  }
  return answers;
}

export interface LlmDecisionProviderOptions {
  /** Defaults to `fastModel()` (live only). */
  model?: LanguageModel;
  /** Builds the fast model from this config instead of the global one. */
  config?: Config;
}

function fastModelFor(c?: Config): LanguageModel {
  if (!c) return fastModel();
  return createAnthropic({ apiKey: requireLive(['anthropic'], c).anthropicApiKey })(c.models.fast);
}

/** Answers DecisionQuestions with a Claude structured-output call in the Jev answer shapes. */
export class LlmDecisionProvider implements DecisionProvider {
  readonly name = 'llm' as const;

  constructor(private readonly opts: LlmDecisionProviderOptions = {}) {}

  async decide(state: unknown, questions: Record<string, DecisionQuestion>) {
    const schema = decisionSchema(questions);
    const fitted = truncateState(state, stateTokenBudget(questions));
    const prompt = JSON.stringify({ state: fitted, questions }, null, 2);
    const model = this.opts.model ?? fastModelFor(this.opts.config);
    const started = performance.now();
    let result;
    try {
      result = await generateText({
        model,
        output: Output.object({ schema, name: 'decisions' }),
        system: SYSTEM,
        prompt,
        temperature: 0,
        experimental_telemetry: { isEnabled: true, functionId: 'decisions.llm', recordInputs: false },
      });
    } catch (err) {
      throw new DecisionError(`LLM decision failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const latencyMs = Math.round(performance.now() - started);
    return {
      answers: toAnswers(result.output.answers, questions),
      inputTokens: result.usage.inputTokens ?? 0,
      latencyMs,
    };
  }
}
