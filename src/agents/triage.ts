import { DecisionError } from '../decisions/errors';
import {
  isChoiceAnswer,
  isFailureClass,
  isNoulAnswer,
  isScoreAnswer,
  TRIAGE_QUESTIONS,
  type Answer,
} from '../decisions/questions';
import { stateTokenBudget, truncateState } from '../decisions/truncate';
import { redact } from '../shared/redact';
import type {
  DecisionProvider,
  DecisionQuestion,
  IncidentContext,
  Stage,
  TriageResult,
} from '../shared/types';

export const PLAN_SUMMARY_MAX_ADDRESSES = 30;

export interface PlanChange {
  address: string;
  action: string;
}

export interface PlanSummary {
  total: number;
  counts: Record<string, number>;
  /** Up to 30 changed (non no-op) resources, in plan order. */
  changes: PlanChange[];
  omitted: number;
}

/** The SPEC §4 triage state sent to the DecisionProvider. */
export interface TriageState {
  runStatus: string;
  stage: Stage;
  errorExcerpt: string;
  planSummary: PlanSummary | null;
  changedFiles: string[];
}

export interface TriageOutcome {
  result: TriageResult;
  /** What was sent, for the `decisions` row (`requestJson`). */
  request: { state: TriageState; questions: Record<string, DecisionQuestion> };
  /** What came back, for the `decisions` row (`responseJson`, `inputTokens`, `latencyMs`). */
  response: { answers: Record<string, Answer>; inputTokens: number; latencyMs: number };
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** MCP results may arrive as JSON text, `{ result }` fixture wrappers, or JSON:API `{ data }`. */
function unwrap(value: unknown, wanted: (o: Obj) => boolean): Obj | undefined {
  let current = parseMaybeJson(value);
  for (let depth = 0; depth < 4 && isObj(current); depth++) {
    if (wanted(current)) return current;
    current = parseMaybeJson(current.result ?? current.data);
  }
  return undefined;
}

export function runStatusOf(run: unknown): string {
  const obj = unwrap(run, (o) => isObj(o.attributes) || typeof o.status === 'string');
  const status = isObj(obj?.attributes) ? obj.attributes.status : obj?.status;
  return typeof status === 'string' ? status : 'unknown';
}

function actionOf(actions: unknown): string {
  if (!Array.isArray(actions) || actions.length === 0) return 'unknown';
  const set = new Set(actions.map(String));
  if (set.has('create') && set.has('delete')) return 'replace';
  return [...set].join('-');
}

export function summarizePlan(planJson: unknown): PlanSummary | null {
  const plan = unwrap(planJson, (o) => Array.isArray(o.resource_changes));
  if (!plan) return null;
  const counts: Record<string, number> = {};
  const changed: PlanChange[] = [];
  for (const rc of plan.resource_changes as unknown[]) {
    if (!isObj(rc)) continue;
    const action = actionOf(isObj(rc.change) ? rc.change.actions : undefined);
    counts[action] = (counts[action] ?? 0) + 1;
    if (action !== 'no-op' && typeof rc.address === 'string') changed.push({ address: rc.address, action });
  }
  const changes = changed.slice(0, PLAN_SUMMARY_MAX_ADDRESSES);
  return {
    total: (plan.resource_changes as unknown[]).length,
    counts,
    changes,
    omitted: changed.length - changes.length,
  };
}

const CHANGED_FILES_KEYS = ['changed-files', 'changed_files', 'changedFiles'];

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : undefined;
}

/** Changed files from the run's configuration version (or its ingress attributes) when the raw run carries them. */
export function changedFilesOf(run: unknown): string[] {
  const root = parseMaybeJson(run);
  const candidates: unknown[] = [];
  const visit = (node: unknown, depth: number) => {
    if (!isObj(node) || depth > 6) return;
    candidates.push(node, node.attributes);
    for (const key of ['result', 'data', 'relationships', 'configuration-version', 'ingress-attributes']) {
      visit(node[key], depth + 1);
    }
    if (Array.isArray(node.included)) node.included.forEach((n) => visit(n, depth + 1));
  };
  visit(root, 0);
  for (const c of candidates) {
    if (!isObj(c)) continue;
    for (const key of CHANGED_FILES_KEYS) {
      const files = stringArray(c[key]);
      if (files) return files;
    }
  }
  return [];
}

export function buildTriageState(ctx: IncidentContext): TriageState {
  const { artifacts } = ctx;
  return {
    runStatus: runStatusOf(artifacts.run),
    stage: artifacts.stage,
    errorExcerpt: redact(artifacts.errorExcerpt),
    planSummary: summarizePlan(artifacts.planJson),
    changedFiles: changedFilesOf(artifacts.run),
  };
}

export function toTriageResult(
  answers: Record<string, Answer>,
  meta: Pick<TriageResult, 'stage' | 'errorExcerpt' | 'provider' | 'inputTokens' | 'latencyMs'>,
): TriageResult {
  const { failure_class, config_fixable, blast_radius, needs_human } = answers;
  if (!isChoiceAnswer(failure_class)) throw new DecisionError('Triage answer "failure_class" is missing');
  if (!isFailureClass(failure_class.choice)) {
    throw new DecisionError(`Triage answer "failure_class" is not a FailureClass: ${failure_class.choice}`);
  }
  if (!isNoulAnswer(config_fixable)) throw new DecisionError('Triage answer "config_fixable" is missing');
  if (!isScoreAnswer(blast_radius)) throw new DecisionError('Triage answer "blast_radius" is missing');
  if (!isNoulAnswer(needs_human)) throw new DecisionError('Triage answer "needs_human" is missing');
  return {
    failureClass: { ...failure_class, choice: failure_class.choice },
    configFixable: config_fixable,
    blastRadius: blast_radius,
    needsHuman: needs_human,
    ...meta,
  };
}

/** SPEC §2 step 2: one decision request with the four §4 questions. Persists nothing. */
export async function triage(ctx: IncidentContext, provider: DecisionProvider): Promise<TriageOutcome> {
  const questions: Record<string, DecisionQuestion> = TRIAGE_QUESTIONS;
  const state = truncateState(buildTriageState(ctx), stateTokenBudget(questions));
  const response = await provider.decide(state, questions);
  const result = toTriageResult(response.answers, {
    stage: state.stage,
    errorExcerpt: state.errorExcerpt,
    provider: provider.name,
    inputTokens: response.inputTokens,
    latencyMs: response.latencyMs,
  });
  return { result, request: { state, questions }, response };
}
