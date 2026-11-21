import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { requireLive, type Config } from '../src/config';
import type {
  ChoiceAnswer,
  DecisionProvider,
  DecisionQuestion,
  FailureClass,
  IncidentContext,
  NoulAnswer,
  Route,
  ScoreAnswer,
  TriageResult,
} from '../src/shared/types';
import { aiTelemetry } from '../src/telemetry';
import { FAILURE_CLASSES } from './schema';

// SPEC §4 reference implementations. The harness prefers W1-B's `src/agents/triage.ts` and
// `src/decisions/routing.ts` when they exist (see deps.ts); these keep the evals runnable
// before that lands and define the exact contract the eval measures.

const CLASS_DEFINITIONS: Record<FailureClass, string> = {
  config_syntax:
    'The configuration is malformed or uses an argument/block the provider or Terraform does not accept.',
  config_reference: 'The configuration refers to a resource, variable, local or output that is not declared.',
  missing_input: 'A required input variable has no value.',
  provider_version: 'Provider version constraints cannot be satisfied or conflict with the lock file.',
  provider_auth: 'The provider rejected or lacks credentials.',
  provider_api_error:
    'A provider or remote API call failed at plan or apply time (network, DNS, HTTP error, quota).',
  apply_runtime: 'A resource or provisioner failed while being applied (non-zero exit, runtime error).',
  precondition_failed: 'A precondition, postcondition or check block assertion failed.',
  module_source: 'A module source or version cannot be found or downloaded.',
  dependency_cycle: 'Resources depend on each other in a cycle.',
  drift: 'Real infrastructure changed outside Terraform and no longer matches state.',
  unknown: 'None of the other classes fits.',
};

export const TRIAGE_QUESTIONS: Record<string, DecisionQuestion> = {
  failure_class: {
    type: 'choice',
    instructions: 'Which class best describes why this Terraform run failed?',
    criteria: CLASS_DEFINITIONS,
  },
  config_fixable: {
    type: 'noul',
    instructions:
      'Can this failure be fixed by changing only the Terraform configuration files, without new credentials, quota, or changes to external systems?',
  },
  blast_radius: {
    type: 'score',
    instructions:
      'How much existing infrastructure would the failing change destroy or replace if it were applied as planned?',
    criteria: [
      'Nothing is destroyed or replaced',
      'Only stateless or trivially recreatable resources',
      'Stateful or shared resources are replaced',
      'Data-bearing or network-critical resources are destroyed',
    ],
  },
  needs_human: {
    type: 'noul',
    instructions:
      'Does fixing this safely require a human decision (ambiguous intent, security-sensitive change, or more than one reasonable fix)?',
  },
};

function prop(value: unknown, ...keys: string[]): unknown {
  let cur = value;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** `resource_changes` → counts by action + up to 30 addresses with their actions. */
export function planSummary(planJson: unknown): {
  counts: Record<string, number>;
  resources: { address: string; actions: string[] }[];
} {
  const changes = prop(planJson, 'resource_changes');
  const rows = (Array.isArray(changes) ? changes : []).map((c) => ({
    address: String(prop(c, 'address') ?? ''),
    actions: (prop(c, 'change', 'actions') as string[] | undefined) ?? [],
  }));
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const key = r.actions.join('+') || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return { counts, resources: rows.slice(0, 30) };
}

export function triageState(ctx: IncidentContext) {
  const { artifacts } = ctx;
  return {
    runStatus: prop(artifacts.run, 'attributes', 'status') ?? 'errored',
    stage: artifacts.stage,
    errorExcerpt: artifacts.errorExcerpt,
    planSummary: planSummary(artifacts.planJson),
    changedFiles: [] as string[],
  };
}

export async function referenceTriage(
  ctx: IncidentContext,
  provider: DecisionProvider,
): Promise<TriageResult> {
  const { answers, inputTokens, latencyMs } = await provider.decide(triageState(ctx), TRIAGE_QUESTIONS);
  const fc = answers.failure_class as ChoiceAnswer;
  const choice = (FAILURE_CLASSES as readonly string[]).includes(fc.choice)
    ? (fc.choice as FailureClass)
    : 'unknown';
  return {
    failureClass: { ...fc, choice },
    configFixable: answers.config_fixable as NoulAnswer,
    blastRadius: answers.blast_radius as ScoreAnswer,
    needsHuman: answers.needs_human as NoulAnswer,
    stage: ctx.artifacts.stage,
    errorExcerpt: ctx.artifacts.errorExcerpt,
    provider: provider.name,
    inputTokens,
    latencyMs,
  };
}

export function referenceRoute(t: TriageResult): Route {
  if (t.failureClass.choice === 'provider_auth' || t.failureClass.choice === 'drift') return 'draftPr';
  return t.configFixable.noul >= 0.7 && t.blastRadius.score <= 1.0 && t.needsHuman.noul <= 0.4
    ? 'autoPr'
    : 'draftPr';
}

type Answers = Record<string, ChoiceAnswer | NoulAnswer | ScoreAnswer>;

/** Replays a recorded `jev.json` (`{ answers, inputTokens, latencyMs }`). */
export function recordedProvider(recorded: unknown, scenario: string): DecisionProvider {
  const parsed = z
    .object({ answers: z.record(z.string(), z.unknown()), inputTokens: z.number(), latencyMs: z.number() })
    .safeParse(recorded);
  if (!parsed.success)
    throw new Error(`Scenario ${scenario} has no valid jev.json for the recorded provider`);
  return {
    name: 'recorded',
    decide: async () => ({
      answers: structuredClone(parsed.data.answers) as Answers,
      inputTokens: parsed.data.inputTokens,
      latencyMs: parsed.data.latencyMs,
    }),
  };
}

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

/** Minimal SPEC §1 Jev client (no retries) for evals. */
export function jevProvider(config: Config): DecisionProvider {
  const { jevApiKey } = requireLive(['jev'], config);
  return {
    name: 'jev',
    async decide(state, questions) {
      const started = performance.now();
      const res = await fetch(JEV_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${jevApiKey}` },
        body: JSON.stringify({ model: 'jev-latest', state, questions }),
      });
      const latencyMs = Math.round(performance.now() - started);
      const body = (await res.json()) as {
        answers?: Record<string, Record<string, unknown>>;
        usage?: { input_tokens?: number };
        message?: string;
        error?: unknown;
      };
      if (!res.ok || !body.answers) {
        throw new Error(
          `Jev ${res.status}: ${body.message ?? JSON.stringify(body.error ?? body).slice(0, 300)}`,
        );
      }
      const answers: Answers = {};
      for (const [name, raw] of Object.entries(body.answers)) {
        if (!('choice' in raw || 'noul' in raw || 'score' in raw)) {
          throw new Error(`Jev answer ${name} has no choice, noul or score`);
        }
        answers[name] = Object.fromEntries(
          Object.entries(raw).filter(([key]) => key !== 'type'),
        ) as unknown as Answers[string];
      }
      return { answers, inputTokens: body.usage?.input_tokens ?? 0, latencyMs };
    },
  };
}

function normalise(probabilities: Record<string, number>): Record<string, number> {
  const total = Object.values(probabilities).reduce((a, b) => a + Math.max(0, b), 0);
  return Object.fromEntries(
    Object.entries(probabilities).map(([k, v]) => [
      k,
      total > 0 ? Math.max(0, v) / total : 1 / Object.keys(probabilities).length,
    ]),
  );
}

function optionsOf(q: DecisionQuestion): string[] {
  if (Array.isArray(q.criteria)) return q.criteria.map((_, i) => String(i));
  return Object.keys(q.criteria ?? {});
}

/** Claude structured-output answers in the Jev shapes (choice/noul/score), probabilities normalised. */
export function llmProvider(config: Config): DecisionProvider {
  const { anthropicApiKey, models } = requireLive(['anthropic'], config);
  const model = createAnthropic({ apiKey: anthropicApiKey })(models.fast);
  return {
    name: 'llm',
    async decide(state, questions) {
      const shape = Object.fromEntries(
        Object.entries(questions).map(([name, q]) => {
          if (q.type === 'noul') return [name, z.object({ probability: z.number().min(0).max(1) })];
          const opts = optionsOf(q);
          return [
            name,
            z.object({
              probabilities: z.object(Object.fromEntries(opts.map((o) => [o, z.number().min(0).max(1)]))),
            }),
          ];
        }),
      );
      const prompt = [
        'You classify a failed HCP Terraform run. Answer every question about the state below.',
        'For choice and score questions give a probability for every option; for yes/no questions give the probability of "yes".',
        `Questions:\n${JSON.stringify(questions, null, 2)}`,
        `State:\n${JSON.stringify(state, null, 2)}`,
      ].join('\n\n');
      const started = performance.now();
      const { output, usage } = await generateText({
        model,
        output: Output.object({ schema: z.object(shape) }),
        prompt,
        experimental_telemetry: aiTelemetry('rerun.eval.llm-decision'),
      });
      const latencyMs = Math.round(performance.now() - started);
      const raw = output as Record<string, { probability?: number; probabilities?: Record<string, number> }>;
      const answers: Answers = {};
      for (const [name, q] of Object.entries(questions)) {
        const a = raw[name];
        if (q.type === 'noul') {
          answers[name] = { noul: a.probability ?? 0 };
          continue;
        }
        const probabilities = normalise(a.probabilities ?? {});
        const [choice, confidence] = Object.entries(probabilities).sort((x, y) => y[1] - x[1])[0];
        if (q.type === 'choice') {
          answers[name] = { choice, confidence, probabilities };
        } else {
          const levels = q.criteria as string[];
          answers[name] = {
            score: Object.entries(probabilities).reduce((sum, [k, p]) => sum + Number(k) * p, 0),
            confidence,
            probabilities,
            legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
          };
        }
      }
      return { answers, inputTokens: usage.inputTokens ?? 0, latencyMs };
    },
  };
}
