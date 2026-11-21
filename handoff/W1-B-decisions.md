# Task: Rerun — DecisionProvider (Jev + LLM + recorded), triage, router

Repo: https://github.com/tayden-b/rerun — branch `work/w1b-decisions` off `dev`, PR into `dev`.
Model: judgment. Read `AGENTS.md`, `handoff/SPEC.md` (§1, §3, §4, §8, §11) and the merged W0-A scaffold first. Git identity per `AGENTS.md`.
You MAY read `JEV_API_KEY` and `RERUN_ANTHROPIC_API_KEY` from your env for the live integration tests only; never print or commit values. If absent, skip those tests and say so.

## Owned paths
`src/decisions/**`, `src/agents/triage.ts`, `fixtures/scenarios/*/jev.json`, `test/decisions/**`.

## Settled facts
- Jev API: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer $JEV_API_KEY`, body `{ model: "jev-latest", state: string|object|array, questions: { <name>: { type: "choice"|"noul"|"score", instructions, criteria } } }`. `choice.criteria` is an object `{option: definition}`; `score.criteria` is an ordered array of level descriptions. Response `{ model, answers: { <name>: {type:"choice", choice, confidence, probabilities} | {type:"noul", noul} | {type:"score", score, confidence, probabilities, legend} }, usage: { input_tokens, output_tokens } }`. Limits: 64k tokens per request, 32k per question. Errors: 400/422 JSON. OpenAPI: `https://api.typesafe.ai/openapi.json`.
- The one triage request and the routing thresholds are specified exactly in SPEC §4. Do not change thresholds; they are tunable constants in one file (`src/decisions/routing.ts`).

## Required behaviour
1. `src/decisions/jev.ts` — `JevDecisionProvider implements DecisionProvider` (SPEC §11): maps `DecisionQuestion` → API body, validates the response with zod, measures `latencyMs`, returns `inputTokens`; retries once on 5xx/429 with jitter; throws `DecisionError` with the API's message on 4xx. Includes a `truncateState(state, maxTokens)` guard (approximate 4 chars/token) applied to `errorExcerpt` first, then `planSummary`.
2. `src/decisions/llm.ts` — `LlmDecisionProvider`: the same questions answered by `fastModel()` with `generateObject` and a zod schema that forces the same answer shapes (probabilities must sum to ~1; normalise). Exists for the eval comparison and as the fallback when `JEV_API_KEY` is unset.
3. `src/decisions/recorded.ts` — `RecordedDecisionProvider`: returns `fixtures/scenarios/<name>/jev.json`; used in demo mode and CI. Also a `recordDecision(provider)` wrapper that writes the fixture when `RERUN_RECORD=1`.
4. `src/decisions/factory.ts` — `createDecisionProvider(config)`: demo → recorded; live with `JEV_API_KEY` → jev; else llm (log a warning once).
5. `src/agents/triage.ts` — `triage(ctx: IncidentContext, provider): Promise<TriageResult>`: builds the SPEC §4 state from `ctx.artifacts` (`planSummary` from `planJson.resource_changes`: counts by action + up to 30 addresses with actions; `changedFiles` from the run's configuration version if available in the raw run, else `[]`), asks the four questions in one request, maps to `TriageResult`. Writes nothing itself — returns the result and the raw request/response so the caller can persist a `decisions` row.
6. `src/decisions/routing.ts` — `route(triage): Route` and `selectAgents(triage): ('config'|'reality')[]` exactly per SPEC §4, with the thresholds as named exported constants.
7. Hand-write `jev.json` for the two placeholder scenarios present in `fixtures/scenarios/` (`apply-time-exit-1`, `undeclared-reference`) with realistic probabilities, marked `"placeholder": true`.

## Tests
- Jev body mapping: snapshot of the request for a sample `IncidentContext` (criteria shapes correct per question type).
- Response parsing: valid payload → `TriageResult`; malformed → `DecisionError`; 32k truncation applied in order.
- Routing table-driven: at least 8 cases incl. both boundary values (0.70, 1.0, 0.40) and the `provider_auth`/`drift` override; `selectAgents` cases.
- `LlmDecisionProvider` schema normalises probabilities; test with a mocked model (`MockLanguageModelV3` from `ai/test`).
- Live (skipped without `JEV_API_KEY`): one real call with the `apply-time-exit-1` state → `failure_class.choice` is a valid `FailureClass`, all four answers present, `inputTokens > 0`. Live (skipped without the Anthropic key): same for the LLM provider.

## Guardrails
- Never log state contents at info level (they contain logs). No suppressions, no sub-agents, pinned deps.

## Done
- CI green. PR title `W1-B: Jev/LLM decision providers, triage, router`. **Do not merge.** Report: PR URL, CI, the live Jev answer for the placeholder state (probabilities only), latency, input tokens.
