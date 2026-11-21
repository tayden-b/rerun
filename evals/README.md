# evals/ — eval suites and scorers (`npm run eval`, `npm run eval:readme`). Owner: W1-F.

- `npm run eval -- [--provider jev|llm|both|recorded] [--scenarios a,b] [--perturbations 5] [--seed 42] [--live] [--out evals/results.json]`
  scores triage on every `fixtures/scenarios/*` with `expected.json` and `mcp/`. Default provider: `recorded` in demo mode, `both` otherwise.
- `npm run eval:readme` renders `evals/results.json` into the README section between `<!-- evals:start -->` and `<!-- evals:end -->`.
- `deps.ts` uses W1-B's `triage` (`src/agents/triage.ts`) and `route` (`src/decisions/routing.ts`) when present, else the SPEC §4 reference in `reference.ts`.
- `live.ts` holds the Wave 2 `runLiveScenario` interface; the stub throws `NotImplemented`.
