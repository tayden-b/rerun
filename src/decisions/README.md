# src/decisions/ — Jev decision provider and fake provider (SPEC §3). Owner: W1-B (also owns `src/agents/triage.ts`).

- `jev.ts` — `JevDecisionProvider` (TypeSafe System One), request mapping, response validation.
- `llm.ts` — `LlmDecisionProvider`: same answer shapes from Claude structured output (eval comparison, fallback).
- `recorded.ts` — `RecordedDecisionProvider` (replays `fixtures/scenarios/<name>/jev.json`) and `recordDecision()` (writes it when `RERUN_RECORD=1`).
- `factory.ts` — `createDecisionProvider(config)`: demo → recorded, live + `JEV_API_KEY` → Jev, else LLM.
- `routing.ts` — `route()` / `selectAgents()` with the SPEC §4 thresholds as named constants.
- `questions.ts` — the four triage questions; `truncate.ts` — fits the state into Jev's token limits.
