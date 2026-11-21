# Task: Rerun — eval harness (triage accuracy, calibration, robustness, live e2e) and telemetry

Repo: https://github.com/tayden-b/rerun — branch `work/w1f-evals` off `dev`, PR into `dev`.
Model: judgment. Read `AGENTS.md`, `handoff/SPEC.md` (§1 Telemetry, §4, §8, §10, §11) and the merged W0-A scaffold first. Git identity per `AGENTS.md`.
You MAY read `JEV_API_KEY`, `RERUN_ANTHROPIC_API_KEY`, `LANGFUSE_*` from your env for live tests only; never print or commit values. If absent, skip live tests and say so.

## Owned paths
`evals/**`, `src/telemetry/**`, `test/evals/**`, `README.md` **only** the section between `<!-- evals:start -->` and `<!-- evals:end -->` markers (add the markers and a placeholder table).
W1-B owns the decision providers and triage (`src/decisions/**`, `src/agents/triage.ts`); code against SPEC §11 interfaces with local fakes in `test/evals/fakes.ts`. W1-A owns the MCP mock; load fixtures from `fixtures/scenarios/<name>/` directly via a tiny loader you write in `evals/fixtures.ts`.

## Required behaviour
1. `evals/run.ts` (`npm run eval [-- --provider jev|llm|both] [--scenarios a,b] [--perturbations 5] [--live] [--out evals/results.json]`):
   - **Triage accuracy**: for each scenario with recorded MCP fixtures + `expected.json`, build `IncidentContext` (reuse `collectRunArtifacts` from `src/mcp` against the in-process mock when available; otherwise construct from the JSON files), run `triage` with each provider, compare `failureClass.choice` and `route(triage)` with `expected`. Per-class precision/recall, overall accuracy, mean latency, mean input tokens, estimated cost (Jev $0.042/Mtok input; Anthropic haiku list price in a constants file with a date).
   - **Calibration**: bins of 0.1 for `configFixable` and `needsHuman` vs. the expected route (autoPr ⇒ fixable=1, needsHuman=0); report ECE and a bins table.
   - **Robustness**: `evals/perturb.ts` — deterministic perturbations of the state (rename resource names consistently, append a UUID comment line to the excerpt, reorder `planSummary` entries, change whitespace); run triage N times per scenario per provider; **flip rate** = share of runs whose `failureClass.choice` or `route` differs from the unperturbed run.
   - **Live e2e** (`--live`): skeleton only in this PR — define the interface `runLiveScenario(name) → { reachedStatus, verifierOk, prUrl, durationMs }` and a stub that throws `NotImplemented('wired in Wave 2 integration')`; the report table must already have the columns.
   - Output `evals/results.json` (schema in `evals/schema.ts`, zod) and a console summary.
2. `evals/readme.ts` (`npm run eval:readme`): renders `results.json` into Markdown tables and replaces the README section between the markers (idempotent).
3. **Telemetry** `src/telemetry/index.ts`: `initTelemetry(config)` — OpenTelemetry NodeSDK with the AI SDK semantic spans; console span exporter in dev when `RERUN_TRACE_CONSOLE=1`; Langfuse exporter (`@langfuse/otel` or the current recommended package — check `https://langfuse.com/docs/observability/get-started`) when keys are set; `instrumentation.ts` for Next.js registers it. `src/telemetry/cost.ts`: `estimateCostUsd({ model, inputTokens, outputTokens })` and `jevCostUsd(inputTokens)` with a dated price table; `summarizeIncidentCost(decisions, agentUsages)`.
4. Placeholder scenarios present in `fixtures/scenarios/` (`apply-time-exit-1`, `undeclared-reference`) must run through the whole harness with the `RecordedDecisionProvider`, so `npm run eval -- --provider recorded` works in CI with no network and produces a results file (perturbation flip rate will be 0 for recorded — fine, note it).

## Tests
- Metrics unit tests with hand-built results (accuracy, per-class P/R, ECE on a known distribution, flip rate).
- `perturb` is deterministic for a seed and preserves the expected class semantics (renames are consistent across state fields).
- `eval:readme` replaces only the marked section (snapshot).
- CI runs `npm run eval -- --provider recorded` and asserts `results.json` validates.
- Live (skipped without keys): `--provider both --scenarios apply-time-exit-1 --perturbations 2` completes and prints a table.

## Guardrails
- No network in CI. No suppressions, no sub-agents, pinned deps. Prices carry a date and a source URL comment.

## Done
- CI green. PR title `W1-F: eval harness and telemetry`. **Do not merge.** Report: PR URL, CI, the live table for the placeholder scenario if keys were present, and the `runLiveScenario` interface for Wave 2.
