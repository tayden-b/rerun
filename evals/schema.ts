import { z } from 'zod';

export const FAILURE_CLASSES = [
  'config_syntax',
  'config_reference',
  'missing_input',
  'provider_version',
  'provider_auth',
  'provider_api_error',
  'apply_runtime',
  'precondition_failed',
  'module_source',
  'dependency_cycle',
  'drift',
  'unknown',
] as const;

export const failureClassSchema = z.enum(FAILURE_CLASSES);
export const stageSchema = z.enum(['init', 'plan', 'apply']);
export const routeSchema = z.enum(['autoPr', 'draftPr']);
export const providerNameSchema = z.enum(['jev', 'llm', 'recorded']);

/** `fixtures/scenarios/<name>/expected.json` (SPEC §8). */
export const expectedSchema = z.looseObject({
  placeholder: z.boolean().optional(),
  failureClass: failureClassSchema,
  stage: stageSchema,
  route: routeSchema,
  fixTouches: z.array(z.string()),
  mustNotTouch: z.array(z.string()),
});
export type Expected = z.infer<typeof expectedSchema>;

const rate = z.number().min(0).max(1);

export const scenarioResultSchema = z.object({
  scenario: z.string(),
  placeholder: z.boolean(),
  expected: z.object({ failureClass: failureClassSchema, stage: stageSchema, route: routeSchema }),
  predicted: z
    .object({
      failureClass: failureClassSchema,
      classConfidence: rate,
      stage: stageSchema,
      route: routeSchema,
      configFixable: rate,
      needsHuman: rate,
      blastRadius: z.number(),
    })
    .nullable(),
  classCorrect: z.boolean(),
  routeCorrect: z.boolean(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  error: z.string().optional(),
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

export const perClassSchema = z.object({
  failureClass: failureClassSchema,
  support: z.number().int().nonnegative(),
  predicted: z.number().int().nonnegative(),
  precision: rate.nullable(),
  recall: rate.nullable(),
});
export type PerClass = z.infer<typeof perClassSchema>;

export const calibrationBinSchema = z.object({
  lo: rate,
  hi: rate,
  count: z.number().int().nonnegative(),
  meanPredicted: rate.nullable(),
  observedRate: rate.nullable(),
});
export const calibrationSchema = z.object({
  ece: rate.nullable(),
  n: z.number().int().nonnegative(),
  bins: z.array(calibrationBinSchema).length(10),
});
export type Calibration = z.infer<typeof calibrationSchema>;

export const robustnessSchema = z.object({
  perturbations: z.number().int().nonnegative(),
  runs: z.number().int().nonnegative(),
  flips: z.number().int().nonnegative(),
  flipRate: rate.nullable(),
  perScenario: z.array(z.object({ scenario: z.string(), runs: z.number().int(), flips: z.number().int() })),
});
export type Robustness = z.infer<typeof robustnessSchema>;

export const providerResultSchema = z.object({
  provider: providerNameSchema,
  scenarios: z.array(scenarioResultSchema),
  summary: z.object({
    n: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    classAccuracy: rate.nullable(),
    routeAccuracy: rate.nullable(),
    latencyMsMean: z.number().nonnegative().nullable(),
    inputTokensMean: z.number().nonnegative().nullable(),
    costUsdTotal: z.number().nonnegative(),
    costUsdPerIncident: z.number().nonnegative().nullable(),
  }),
  perClass: z.array(perClassSchema),
  calibration: z.object({ configFixable: calibrationSchema, needsHuman: calibrationSchema }),
  robustness: robustnessSchema,
});
export type ProviderResult = z.infer<typeof providerResultSchema>;

/** Why a live run could not complete: an outside dependency failed, not Rerun. */
export const liveBlockedSchema = z.object({
  reason: z.string(),
  at: z.iso.datetime(),
  errorClass: z.string(),
  error: z.string(),
});

/** One row of the live end-to-end table (SPEC §8.4). */
export const liveRowSchema = z.object({
  scenario: z.string(),
  reachedStatus: z.string().nullable(),
  verifierOk: z.boolean().nullable(),
  prUrl: z.string().nullable(),
  fixTouchesRespected: z.boolean().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  runId: z.string().optional(),
  incidentId: z.string().optional(),
  expectedClass: z.string().optional(),
  failureClass: z.string().nullable().optional(),
  expectedRoute: z.string().optional(),
  route: z.string().nullable().optional(),
  draft: z.boolean().nullable().optional(),
  costUsd: z.number().nonnegative().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  phasesMs: z.record(z.string(), z.number().nonnegative()).optional(),
  error: z.string().optional(),
  blocked: liveBlockedSchema.optional(),
});
export type LiveRow = z.infer<typeof liveRowSchema>;

export const evalResultsSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  options: z.object({
    providers: z.array(providerNameSchema).min(1),
    scenarios: z.array(z.string()),
    perturbations: z.number().int().nonnegative(),
    seed: z.number().int(),
    live: z.boolean(),
  }),
  pricesAsOf: z.string(),
  providers: z.array(providerResultSchema),
  live: z.object({
    ran: z.boolean(),
    rows: z.array(liveRowSchema),
    /** One scenario taken from approve to `resolved` (`evals/resolve.ts`). */
    resolve: z
      .object({
        scenario: z.string(),
        incidentId: z.string().optional(),
        reachedStatus: z.string().nullable(),
        phasesMs: z.record(z.string(), z.number().nonnegative()).optional(),
        blocked: liveBlockedSchema.optional(),
      })
      .optional(),
  }),
  notes: z.array(z.string()),
});
export type EvalResults = z.infer<typeof evalResultsSchema>;
