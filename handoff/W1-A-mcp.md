# Task: Rerun — Terraform MCP client (scoped, allowlisted), mock MCP server, fixture recorder

Repo: https://github.com/tayden-b/rerun — branch `work/w1a-mcp` off `dev`, PR into `dev`.
Model: judgment. Read `AGENTS.md`, `handoff/SPEC.md` (§1, §2 step 1, §5, §9, §10, §11) and the merged W0-A scaffold first. Git identity per `AGENTS.md`.
You MAY read `TFE_TOKEN` and `TFE_ORG` from your env to run the real MCP server locally for recording `fixtures/mcp/tools-list.json` and for the client integration test; never print or commit values. If absent, use the mock only and say so.

## Owned paths
`src/mcp/**`, `fixtures/mcp/**`, `fixtures/scenarios/*/mcp/**`, `scripts/record.ts`, `test/mcp/**`. Do not touch other directories except adding your npm script implementations that W0-A pre-created (`record`, `mock-mcp`).

## Required behaviour
1. **Real server locally**: `docker run --rm -p 8080:8080 -e TRANSPORT_MODE=streamable-http -e TRANSPORT_HOST=0.0.0.0 -e TFE_TOKEN -e TFE_ADDRESS=https://app.terraform.io hashicorp/terraform-mcp-server:1.4 --tools <SPEC §5 list>` (confirm exact flag/env names from `--help` and the reference at https://developer.hashicorp.com/terraform/mcp-server/reference). Capture `tools/list` to `fixtures/mcp/tools-list.json` (pretty JSON, sorted by name). This is the contract for argument names — derive every wrapper from it, do not guess.
2. **Client** `src/mcp/terraform.ts`: built on the AI SDK 6 MCP client (`experimental_createMCPClient` with the streamable-HTTP transport from `@modelcontextprotocol/sdk`) or the SDK's client directly — pick one and justify in a code comment. Export `createTerraformMcp(opts: { url, workspace, org })` returning typed methods for exactly the SPEC §5 tools (`listRuns({status?, pageSize?})`, `getRunDetails(runId)`, `getPlanDetails/Logs/JsonOutput(planId)`, `getApplyDetails/Logs(applyId)`, `getWorkspaceDetails()`, `listStateVersions()`, `getStateVersion()`, `getRunComments(runId)`, `whoami()`, `searchProviderDocs(...)`, `getProviderDetails(...)`, `getLatestProviderVersion(...)`, `getProviderCapabilities(...)`) plus `tools()` for passing the registry docs tools to an AI SDK agent (`ToolSet`) **filtered to the registry toolset only**. Every workspace-bearing call injects `terraform_org_name`/`workspace_name` from opts; if a caller passes a different workspace → throw `WorkspaceScopeError` before any network call. Any tool not in the allowlist → `ToolNotAllowedError`. Results are returned both raw (`unknown`) and, where the server returns text, parsed with a tolerant parser (JSON if parseable, else `{ text }`).
3. **`collectRunArtifacts(mcp, runId): Promise<RunArtifacts>`** (SPEC §11): fetches run, workspace, plan details/logs/json when the run has a plan, apply details/logs when it has an apply, latest state version; determines `stage` (`init|plan|apply`) from run status + which phase errored (document the rule you implement from real data); builds `errorExcerpt` with `extractErrorExcerpt` + `redact` from `src/shared`. Every call is logged as a `tool_call`/`tool_result` event through an injected `emit(event)` callback (no DB dependency here).
4. **Mock server** `src/mcp/mock/server.ts` (replace the W0-A stub internals, keep names): a real MCP streamable-HTTP server with the same tool names/schemas as `tools-list.json`; `?scenario=<name>` query or `MOCK_SCENARIO` env selects `fixtures/scenarios/<name>/mcp/`; each tool returns the recorded JSON for that scenario (`<tool>.json`, or `<tool>.<argHash>.json` when a tool was recorded with several argument sets — document the hashing); missing fixture → MCP error with the path it looked for. Must be startable in-process (`startMockServer({port})` returning `{url, close}`) for tests and `npm run demo`.
5. **Recorder** `scripts/record.ts` (`npm run record -- --scenario <name> --run <runId>`): connects to the real server, calls every tool `collectRunArtifacts` would call for that run (plus `list_runs` for the workspace and `whoami`), writes redacted JSON into `fixtures/scenarios/<name>/mcp/`, and writes `fixtures/scenarios/<name>/recording.json` `{ runId, recordedAt, tools: [...] }`. Must be re-runnable (overwrites). The Wave 2 recording worker will run it for all 11 scenarios; make the CLI help text explicit.
6. **Placeholder fixtures**: convert W0-A's `apply-time-exit-1` placeholder to your file layout and add a second hand-written scenario `undeclared-reference` so two scenarios work in the mock before real recordings exist. Keep `"placeholder": true` markers.

## Tests (vitest, demo mode, no network)
- `WorkspaceScopeError` when a call names another workspace; `ToolNotAllowedError` for `create_run`.
- Against the in-process mock: `collectRunArtifacts` for both placeholder scenarios returns the expected `stage`, non-empty `errorExcerpt`, and emits events in order.
- `tools()` exposes only registry tools.
- Integration (skipped unless `TFE_TOKEN` is set): `whoami()` succeeds and `listRuns()` on `RERUN_WORKSPACE` returns an array; `listWorkspaces` is **not** exposed beyond proving the scope filter (one test that lists and asserts the client refuses to fetch details for any other name).

## Guardrails
- Allowlist only; never set `ENABLE_TF_OPERATIONS`. Never log full tool results at info level (debug only, redacted).
- No suppressions, no sub-agents, pinned deps. Synthetic/redacted data only in fixtures.

## Done
- CI green. PR title `W1-A: scoped Terraform MCP client, mock server, recorder`. **Do not merge.** Report: PR URL, CI, the exact `--tools`/env invocation that worked for the real server, the `stage` rule you derived, and any tool whose arguments differed from the reference docs.


## Orchestrator notes (added after cross-brief review — these override anything above)
- **Credentials in your env**: the scoped keys this brief allows you to use are org secrets that may not be in your shell env by default. Bind them per command via exec `env`, e.g. `{"JEV_API_KEY": "secret:org:JEV_API_KEY"}`, `{"RERUN_ANTHROPIC_API_KEY": "secret:org:RERUN_ANTHROPIC_API_KEY"}`, `{"TFE_TOKEN": "secret:org:TFE_TOKEN", "TFE_ORG": "secret:org:TFE_ORG"}`, `{"GITHUB_TOKEN": "secret:org:GITHUB_TOKEN"}`. Only the ones your brief names. Never print/echo/commit values. GitHub CI never has them.
- **Workspace scope**: touch only the HCP Terraform workspace `rerun-fixtures` in `hashi-org-TF`. Never set `ENABLE_TF_OPERATIONS`.
- **Shared files** (`package.json`, `package-lock.json`, `.github/workflows/ci.yml`): six Wave 1 workers run in parallel. Only add your deps/scripts to `package.json` (pinned, `save-exact`); do not reorder or reformat it. Do not edit `.github/workflows/ci.yml` unless this brief says so. Before your final push, `git merge origin/dev`; on lockfile conflicts take `dev`'s lockfile and re-run `npm install` to regenerate, never hand-edit it.
- **AI SDK 6 / MCP API names**: where a brief names an API (`generateObject`, `experimental_createMCPClient`, `MockLanguageModelV3`), use the current non-deprecated equivalent in the pinned version (e.g. `generateText` with `output: Output.object(...)`, `createMCPClient` from `@ai-sdk/mcp`) and note the choice in your PR.
- Do not change `src/shared/types.ts`. If a SPEC §11 type genuinely blocks you, explain in the PR and update `handoff/SPEC.md` §11 in the same PR.
- Work fast: compute is free; the orchestrator is waiting on your PR to start the next wave.
- You also own `fixtures/scenarios/undeclared-reference/expected.json` (SPEC §8/§10 schema: `config_reference`, `plan`, `autoPr`, `fixTouches: ["main.tf"]`, `mustNotTouch: ["versions.tf"]`, `"placeholder": true`). W1-B adds `jev.json` in the same directory in parallel — do not create that file.
- The real `--tools` list must match the SPEC §5 allowlist; if the 1.4 server names a tool differently, record the real name in `fixtures/mcp/tools-list.json`, use it, and list the difference in your PR.
