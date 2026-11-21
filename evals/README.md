# evals/ — eval suites and scorers (`npm run eval`, `npm run eval:readme`). Owner: W1-F.

- `npm run eval -- [--provider jev|llm|both|recorded] [--scenarios a,b] [--perturbations 5] [--seed 42] [--live] [--out evals/results.json]`
  scores triage on every `fixtures/scenarios/*` with `expected.json` and `mcp/`. Default provider: `recorded` in demo mode, `both` otherwise.
- `npm run eval:readme` renders `evals/results.json` into the README section between `<!-- evals:start -->` and `<!-- evals:end -->`.
- Scenarios are collected with W1-A's `collectRunArtifacts` against the in-process mock MCP server; triage, routing and providers are W1-B's production code (`evals/deps.ts`).
- `live.ts` holds the Wave 2 `runLiveScenario` interface; the stub throws `NotImplemented`.
