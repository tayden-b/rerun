import { z } from 'zod';
import { requireLive } from '../config';
import type { DecisionProvider, DecisionQuestion } from '../shared/types';
import { DecisionError } from './errors';
import type { Answer } from './questions';
import { stateTokenBudget, truncateState } from './truncate';

export { truncateState } from './truncate';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_AFTER_MS = 10_000;

export interface JevQuestion {
  type: DecisionQuestion['type'];
  instructions: string;
  criteria?: Record<string, string> | string[];
}

export interface JevRequest {
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
}

const choiceAnswer = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
});
const noulAnswer = z.object({ type: z.literal('noul'), noul: z.number() });
const scoreAnswer = z.object({
  type: z.literal('score'),
  score: z.number(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
  legend: z.record(z.string(), z.unknown()),
});

export const jevResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.discriminatedUnion('type', [choiceAnswer, noulAnswer, scoreAnswer])),
  usage: z.object({ input_tokens: z.number().int(), output_tokens: z.number().int() }),
});
export type JevResponse = z.infer<typeof jevResponseSchema>;

function mapQuestion(name: string, q: DecisionQuestion): JevQuestion {
  const out: JevQuestion = { type: q.type, instructions: q.instructions };
  if (q.type === 'choice') {
    if (!q.criteria || Array.isArray(q.criteria) || Object.keys(q.criteria).length === 0) {
      throw new DecisionError(
        `Question "${name}": choice criteria must be a non-empty {option: definition} object`,
      );
    }
    out.criteria = q.criteria;
  } else if (q.type === 'score') {
    if (!Array.isArray(q.criteria) || q.criteria.length === 0 || q.criteria.length > 10) {
      throw new DecisionError(`Question "${name}": score criteria must be an ordered array of 1-10 levels`);
    }
    out.criteria = q.criteria;
  } else if (q.criteria !== undefined) {
    if (Array.isArray(q.criteria) || Object.keys(q.criteria).some((k) => k !== 'true' && k !== 'false')) {
      throw new DecisionError(`Question "${name}": noul criteria may only define "true" and "false"`);
    }
    out.criteria = q.criteria;
  }
  return out;
}

/** Maps DecisionQuestions to a System One request body, truncating the state to fit Jev's limits. */
export function buildJevRequest(
  state: unknown,
  questions: Record<string, DecisionQuestion>,
  model: string = JEV_MODEL,
): JevRequest {
  const mapped = Object.fromEntries(
    Object.entries(questions).map(([name, q]) => [name, mapQuestion(name, q)]),
  );
  if (Object.keys(mapped).length === 0) throw new DecisionError('At least one question is required');
  return { model, state: truncateState(state, stateTokenBudget(questions)), questions: mapped };
}

/** Validates a System One response against the questions asked and strips the `type` tags. */
export function parseJevResponse(
  body: unknown,
  questions: Record<string, DecisionQuestion>,
): { answers: Record<string, Answer>; inputTokens: number } {
  const parsed = jevResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new DecisionError(`Malformed Jev response: ${z.prettifyError(parsed.error)}`);
  }
  const answers: Record<string, Answer> = {};
  for (const [name, q] of Object.entries(questions)) {
    const a = parsed.data.answers[name];
    if (!a) throw new DecisionError(`Jev response has no answer for "${name}"`);
    if (a.type !== q.type) throw new DecisionError(`Jev answered "${name}" as ${a.type}, expected ${q.type}`);
    if (a.type === 'choice') {
      answers[name] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
    } else if (a.type === 'noul') {
      answers[name] = { noul: a.noul };
    } else {
      const legend = Object.fromEntries(
        Object.entries(a.legend).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
      );
      answers[name] = { score: a.score, confidence: a.confidence, probabilities: a.probabilities, legend };
    }
  }
  return { answers, inputTokens: parsed.data.usage.input_tokens };
}

function apiMessage(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('detail' in body)) return fallback;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: unknown[]; msg?: string }) =>
        [Array.isArray(d.loc) ? d.loc.join('.') : undefined, d.msg].filter(Boolean).join(': '),
      )
      .join('; ');
  }
  if (typeof detail === 'object' && detail !== null) {
    const message = (detail as { message?: unknown }).message;
    return typeof message === 'string' ? message : JSON.stringify(detail);
  }
  return fallback;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function defaultRetryDelay(retryAfter: string | null): number {
  const jitter = 250 + Math.random() * 750;
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) + jitter;
  return jitter;
}

export interface JevDecisionProviderOptions {
  /** Defaults to `JEV_API_KEY` via `requireLive(['jev'])`. */
  apiKey?: string;
  url?: string;
  model?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Delay before the single retry; receives the `Retry-After` header. */
  retryDelayMs?: (retryAfter: string | null) => number;
}

export class JevDecisionProvider implements DecisionProvider {
  readonly name = 'jev' as const;
  private readonly apiKey: string;
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: (retryAfter: string | null) => number;

  constructor(opts: JevDecisionProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? (requireLive(['jev']).jevApiKey as string);
    this.url = opts.url ?? JEV_URL;
    this.model = opts.model ?? JEV_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetch ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? defaultRetryDelay;
  }

  async decide(state: unknown, questions: Record<string, DecisionQuestion>) {
    const body = buildJevRequest(state, questions, this.model);
    const started = performance.now();
    const json = await this.post(body);
    const latencyMs = Math.round(performance.now() - started);
    return { ...parseJevResponse(json, questions), latencyMs };
  }

  private async post(body: JevRequest): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= 1;
      let res: Response;
      try {
        res = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (!last) {
          await sleep(this.retryDelayMs(null));
          continue;
        }
        throw new DecisionError(`Jev request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (res.ok) {
        try {
          return await res.json();
        } catch {
          throw new DecisionError('Malformed Jev response: body is not JSON', res.status);
        }
      }
      if (isRetryable(res.status) && !last) {
        await sleep(this.retryDelayMs(res.headers.get('retry-after')));
        continue;
      }
      const errBody: unknown = await res.json().catch(() => undefined);
      throw new DecisionError(
        `Jev request failed (${res.status}): ${apiMessage(errBody, res.statusText || 'no error detail')}`,
        res.status,
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
