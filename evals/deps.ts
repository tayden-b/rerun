import path from 'node:path';
import { requireLive, type Config } from '../src/config';
import { triage } from '../src/agents/triage';
import { JevDecisionProvider } from '../src/decisions/jev';
import { LlmDecisionProvider } from '../src/decisions/llm';
import { RecordedDecisionProvider } from '../src/decisions/recorded';
import { route } from '../src/decisions/routing';
import type { DecisionProvider, IncidentContext, Route, TriageResult } from '../src/shared/types';
import type { Scenario } from './fixtures';

export type ProviderName = DecisionProvider['name'];

export interface EvalDeps {
  triage(ctx: IncidentContext, provider: DecisionProvider): Promise<TriageResult>;
  route(triage: TriageResult): Route;
  createProvider(name: ProviderName, scenario: Scenario, config: Config): DecisionProvider;
}

/** The production triage (`src/agents/triage.ts`), router and decision providers (W1-B). */
export const productionDeps: EvalDeps = {
  triage: async (ctx, provider) => (await triage(ctx, provider)).result,
  route,
  createProvider(name, scenario, config) {
    if (name === 'recorded') {
      return new RecordedDecisionProvider({
        scenario: scenario.name,
        scenariosDir: path.dirname(scenario.dir),
      });
    }
    if (name === 'jev') return new JevDecisionProvider({ apiKey: requireLive(['jev'], config).jevApiKey });
    return new LlmDecisionProvider({ config });
  },
};
