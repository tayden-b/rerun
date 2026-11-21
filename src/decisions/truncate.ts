import type { DecisionQuestion } from '../shared/types';
import { DecisionError } from './errors';

/** Jev limits (TypeSafe System One): 64k tokens per request, 32k per question. */
export const JEV_REQUEST_TOKEN_LIMIT = 64_000;
export const JEV_QUESTION_TOKEN_LIMIT = 32_000;
/** Headroom for the request envelope and the tokenizer differing from the 4 chars/token estimate. */
export const STATE_TOKEN_MARGIN = 1_000;
/** `errorExcerpt` is first trimmed to this floor before `planSummary` is touched. */
export const MIN_EXCERPT_CHARS = 2_000;

const CHARS_PER_TOKEN = 4;

export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Tokens the state may use so that every question (state + question) and the whole request fit. */
export function stateTokenBudget(questions: Record<string, DecisionQuestion>): number {
  const sizes = Object.values(questions).map(estimateTokens);
  const largest = Math.max(0, ...sizes);
  const total = sizes.reduce((a, b) => a + b, 0);
  return Math.min(JEV_QUESTION_TOKEN_LIMIT - largest, JEV_REQUEST_TOKEN_LIMIT - total) - STATE_TOKEN_MARGIN;
}

/** Keeps the head and tail of `text` within `maxChars`, marking the cut. */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  const marker = `\n… [truncated ${omitted} chars] …\n`;
  const room = Math.max(0, maxChars - marker.length);
  const head = Math.ceil((room * 2) / 3);
  const tail = room - head;
  return text.slice(0, head) + marker + (tail > 0 ? text.slice(-tail) : '');
}

type StateObject = Record<string, unknown>;

function isObject(value: unknown): value is StateObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function overChars(state: unknown, maxTokens: number): number {
  return (estimateTokens(state) - maxTokens) * CHARS_PER_TOKEN;
}

function shrinkExcerpt(state: StateObject, maxTokens: number, floor: number): StateObject {
  const excerpt = state.errorExcerpt;
  const over = overChars(state, maxTokens);
  if (typeof excerpt !== 'string' || over <= 0 || excerpt.length <= floor) return state;
  // JSON escaping makes the serialised excerpt longer than the raw string; iterate until it fits.
  let target = Math.max(floor, excerpt.length - over);
  let next: StateObject = { ...state, errorExcerpt: truncateText(excerpt, target) };
  while (overChars(next, maxTokens) > 0 && target > floor) {
    target = Math.max(floor, target - overChars(next, maxTokens));
    next = { ...state, errorExcerpt: truncateText(excerpt, target) };
  }
  return next;
}

function shrinkPlanSummary(state: StateObject, maxTokens: number): StateObject {
  const plan = state.planSummary;
  if (!isObject(plan) || !Array.isArray(plan.changes)) return state;
  const changes = [...plan.changes];
  const omittedBefore = typeof plan.omitted === 'number' ? plan.omitted : 0;
  let next = state;
  let over = overChars(state, maxTokens);
  while (over > 0 && changes.length > 0) {
    over -= (JSON.stringify(changes.pop()) ?? '').length + 1;
    if (over <= 0 || changes.length === 0) {
      next = {
        ...state,
        planSummary: {
          ...plan,
          changes: [...changes],
          omitted: omittedBefore + plan.changes.length - changes.length,
        },
      };
      over = overChars(next, maxTokens);
    }
  }
  return next;
}

/**
 * Fits a triage state into `maxTokens` (approx. 4 chars/token). Trims `errorExcerpt` (head and
 * tail kept) down to MIN_EXCERPT_CHARS first, then drops `planSummary.changes` from the end, then
 * trims `errorExcerpt` further. Throws DecisionError if the state still does not fit.
 */
export function truncateState<T>(state: T, maxTokens: number): T {
  if (estimateTokens(state) <= maxTokens) return state;
  if (typeof state === 'string') {
    return truncateText(state, Math.max(0, maxTokens * CHARS_PER_TOKEN - 2)) as T;
  }
  if (isObject(state)) {
    let next = shrinkExcerpt(state, maxTokens, MIN_EXCERPT_CHARS);
    next = shrinkPlanSummary(next, maxTokens);
    next = shrinkExcerpt(next, maxTokens, 0);
    if (estimateTokens(next) <= maxTokens) return next as T;
  }
  throw new DecisionError(
    `Decision state is ~${estimateTokens(state)} tokens and cannot be truncated below the ${maxTokens}-token budget`,
  );
}
