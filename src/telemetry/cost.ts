import { DEFAULT_MODELS } from '../config';

export interface ModelPrice {
  /** USD per million input tokens. */
  inputPerMtok: number;
  /** USD per million output tokens. */
  outputPerMtok: number;
}

/** List prices as of this date. Re-check the sources below before changing. */
export const PRICES_AS_OF = '2026-11-20';

// Source: https://docs.claude.com/en/docs/about-claude/pricing (base tokens, prompts ≤ 100k tokens).
export const ANTHROPIC_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': { inputPerMtok: 0.1, outputPerMtok: 0.5 },
  'claude-sonnet-5-5': { inputPerMtok: 2, outputPerMtok: 10 },
};

// Source: https://typesafe.ai/pricing (jev-1.14.0: $0.042 per million input tokens).
export const JEV_INPUT_PER_MTOK = 0.042;

const MTOK = 1_000_000;

/** Matches exact ids and dated snapshots such as `claude-haiku-5-5-20261001`. */
export function priceFor(model: string): ModelPrice | undefined {
  if (ANTHROPIC_PRICES[model]) return ANTHROPIC_PRICES[model];
  const key = Object.keys(ANTHROPIC_PRICES).find(
    (id) => model.startsWith(`${id}-`) && /^\d{8}$/.test(model.slice(id.length + 1)),
  );
  return key ? ANTHROPIC_PRICES[key] : undefined;
}

/** USD for one model call; 0 for a model missing from the price table. */
export function estimateCostUsd(usage: { model: string; inputTokens: number; outputTokens: number }): number {
  const price = priceFor(usage.model);
  if (!price) return 0;
  return (usage.inputTokens * price.inputPerMtok + usage.outputTokens * price.outputPerMtok) / MTOK;
}

export function jevCostUsd(inputTokens: number): number {
  return (inputTokens * JEV_INPUT_PER_MTOK) / MTOK;
}

export interface DecisionUsage {
  provider: 'jev' | 'llm' | 'recorded';
  inputTokens: number;
  /** Model that answered an `llm` decision; defaults to the fast model. */
  model?: string;
}

export interface AgentUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelCost extends AgentUsage {
  costUsd: number;
}

export interface IncidentCost {
  models: ModelCost[];
  jev: { inputTokens: number; costUsd: number };
  /** Models with usage but no price-table entry (counted as $0). */
  unpricedModels: string[];
  totalUsd: number;
  pricesAsOf: string;
}

/**
 * Per-incident cost: Jev input tokens plus tokens per model. `llm` decisions are charged
 * to their model (input only; `DecisionProvider` does not report output tokens).
 * `recorded` decisions replay a fixture and cost nothing.
 */
export function summarizeIncidentCost(decisions: DecisionUsage[], agentUsages: AgentUsage[]): IncidentCost {
  const byModel = new Map<string, AgentUsage>();
  const add = (u: AgentUsage) => {
    const row = byModel.get(u.model) ?? { model: u.model, inputTokens: 0, outputTokens: 0 };
    row.inputTokens += u.inputTokens;
    row.outputTokens += u.outputTokens;
    byModel.set(u.model, row);
  };
  let jevTokens = 0;
  for (const d of decisions) {
    if (d.provider === 'jev') jevTokens += d.inputTokens;
    else if (d.provider === 'llm')
      add({ model: d.model ?? DEFAULT_MODELS.fast, inputTokens: d.inputTokens, outputTokens: 0 });
  }
  agentUsages.forEach(add);

  const models = [...byModel.values()]
    .sort((a, b) => a.model.localeCompare(b.model))
    .map((u) => ({ ...u, costUsd: estimateCostUsd(u) }));
  const jev = { inputTokens: jevTokens, costUsd: jevCostUsd(jevTokens) };
  return {
    models,
    jev,
    unpricedModels: models.filter((m) => !priceFor(m.model)).map((m) => m.model),
    totalUsd: jev.costUsd + models.reduce((sum, m) => sum + m.costUsd, 0),
    pricesAsOf: PRICES_AS_OF,
  };
}
