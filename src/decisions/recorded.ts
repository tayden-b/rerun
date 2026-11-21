import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { DecisionProvider, DecisionQuestion } from '../shared/types';
import { DecisionError } from './errors';
import { isChoiceAnswer, isNoulAnswer, isScoreAnswer, type Answer } from './questions';

export const SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');
export const DEFAULT_RECORDED_SCENARIO = 'apply-time-exit-1';

const recordedAnswer = z.union([
  z.object({ choice: z.string(), confidence: z.number(), probabilities: z.record(z.string(), z.number()) }),
  z.object({ noul: z.number() }),
  z.object({
    score: z.number(),
    confidence: z.number(),
    probabilities: z.record(z.string(), z.number()),
    legend: z.record(z.string(), z.string()),
  }),
]);

/** `fixtures/scenarios/<name>/jev.json`. */
export const recordedDecisionSchema = z.object({
  placeholder: z.boolean().optional(),
  provider: z.enum(['jev', 'llm']).optional(),
  recordedAt: z.string().optional(),
  answers: z.record(z.string(), recordedAnswer),
  inputTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
});
export type RecordedDecision = z.infer<typeof recordedDecisionSchema>;

export function recordedDecisionPath(scenario: string, scenariosDir: string = SCENARIOS_DIR): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(scenario)) throw new DecisionError(`Invalid scenario name "${scenario}"`);
  return path.join(scenariosDir, scenario, 'jev.json');
}

function matchesType(answer: Answer | undefined, type: DecisionQuestion['type']): boolean {
  if (type === 'choice') return isChoiceAnswer(answer);
  if (type === 'score') return isScoreAnswer(answer);
  return isNoulAnswer(answer);
}

export interface RecordedDecisionProviderOptions {
  /** Defaults to `MOCK_SCENARIO`, then `apply-time-exit-1` (the mock MCP server's default). */
  scenario?: string;
  scenariosDir?: string;
}

/** Replays `fixtures/scenarios/<scenario>/jev.json`; used in demo mode and CI. */
export class RecordedDecisionProvider implements DecisionProvider {
  readonly name = 'recorded' as const;
  readonly scenario: string;
  private readonly scenariosDir: string;

  constructor(opts: RecordedDecisionProviderOptions = {}) {
    this.scenario = opts.scenario ?? process.env.MOCK_SCENARIO ?? DEFAULT_RECORDED_SCENARIO;
    this.scenariosDir = opts.scenariosDir ?? SCENARIOS_DIR;
  }

  async decide(_state: unknown, questions: Record<string, DecisionQuestion>) {
    const file = recordedDecisionPath(this.scenario, this.scenariosDir);
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      throw new DecisionError(`No recorded decision for scenario "${this.scenario}" (${file})`);
    }
    const parsed = recordedDecisionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new DecisionError(`Malformed recorded decision ${file}: ${z.prettifyError(parsed.error)}`);
    }
    const answers: Record<string, Answer> = {};
    for (const [name, q] of Object.entries(questions)) {
      const a = parsed.data.answers[name] as Answer | undefined;
      if (!matchesType(a, q.type)) {
        throw new DecisionError(`Recorded decision ${file} has no ${q.type} answer for "${name}"`);
      }
      answers[name] = a as Answer;
    }
    return { answers, inputTokens: parsed.data.inputTokens, latencyMs: parsed.data.latencyMs };
  }
}

export interface RecordDecisionOptions {
  scenario: string;
  scenariosDir?: string;
  /** Defaults to `RERUN_RECORD=1`. */
  enabled?: boolean;
}

/** Wraps a live provider so each decision is written to the scenario's `jev.json` when recording. */
export function recordDecision(provider: DecisionProvider, opts: RecordDecisionOptions): DecisionProvider {
  const enabled = opts.enabled ?? process.env.RERUN_RECORD === '1';
  if (!enabled || provider.name === 'recorded') return provider;
  const file = recordedDecisionPath(opts.scenario, opts.scenariosDir);
  return {
    name: provider.name,
    async decide(state, questions) {
      const result = await provider.decide(state, questions);
      const record: RecordedDecision = {
        provider: provider.name as 'jev' | 'llm',
        recordedAt: new Date().toISOString(),
        answers: result.answers,
        inputTokens: result.inputTokens,
        latencyMs: result.latencyMs,
      };
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
      return result;
    },
  };
}
