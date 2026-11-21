import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from '../src/config';
import type { DecisionProvider, IncidentContext, Route, TriageResult } from '../src/shared/types';
import type { Scenario } from './fixtures';
import { jevProvider, llmProvider, recordedProvider, referenceRoute, referenceTriage } from './reference';

export type ProviderName = DecisionProvider['name'];

export interface EvalDeps {
  triage(ctx: IncidentContext, provider: DecisionProvider): Promise<TriageResult>;
  route(triage: TriageResult): Route;
  createProvider(name: ProviderName, scenario: Scenario, config: Config): DecisionProvider;
  /** Where `triage`/`route` came from, recorded in the results notes. */
  sources: { triage: string; route: string };
}

export const referenceDeps: EvalDeps = {
  triage: referenceTriage,
  route: referenceRoute,
  createProvider(name, scenario, config) {
    if (name === 'recorded') return recordedProvider(scenario.recordedDecision, scenario.name);
    if (name === 'jev') return jevProvider(config);
    return llmProvider(config);
  },
  sources: { triage: 'evals/reference.ts', route: 'evals/reference.ts' },
};

function isTriageResult(value: unknown): value is TriageResult {
  return !!value && typeof value === 'object' && 'failureClass' in value && 'configFixable' in value;
}

/** Accepts `TriageResult` or a wrapper carrying it (`{ result }` / `{ triage }`, plus raw request/response). */
export function unwrapTriage(value: unknown): TriageResult {
  if (isTriageResult(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['result', 'triage']) {
      const inner = (value as Record<string, unknown>)[key];
      if (isTriageResult(inner)) return inner;
    }
  }
  throw new Error('triage() returned neither a TriageResult nor { result | triage: TriageResult }');
}

async function importIfPresent(rel: string): Promise<Record<string, unknown> | undefined> {
  const file = path.join(process.cwd(), rel);
  if (!existsSync(file)) return undefined;
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

/**
 * Uses W1-B's `triage` (src/agents/triage.ts) and `route` (src/decisions/routing.ts) when present,
 * so the eval measures the production code; falls back to the SPEC §4 reference otherwise.
 * Providers stay the eval's own thin clients (SPEC §11 `DecisionProvider`).
 */
export async function resolveDeps(): Promise<EvalDeps> {
  const triageMod = await importIfPresent('src/agents/triage.ts');
  const routingMod = await importIfPresent('src/decisions/routing.ts');
  const triageFn = triageMod?.triage;
  const routeFn = routingMod?.route;
  return {
    ...referenceDeps,
    triage:
      typeof triageFn === 'function'
        ? async (ctx, provider) => unwrapTriage(await triageFn(ctx, provider))
        : referenceDeps.triage,
    route: typeof routeFn === 'function' ? (t) => routeFn(t) as Route : referenceDeps.route,
    sources: {
      triage: typeof triageFn === 'function' ? 'src/agents/triage.ts' : referenceDeps.sources.triage,
      route: typeof routeFn === 'function' ? 'src/decisions/routing.ts' : referenceDeps.sources.route,
    },
  };
}
