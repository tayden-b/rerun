# Task: Rerun — record real MCP + Jev fixtures for all 11 scenarios

Repos: app https://github.com/tayden-b/rerun (branch `work/w2r-recording` off `dev`, PR into `dev`) and fixtures https://github.com/tayden-b/rerun-fixtures (you push scenario commits to its `main` via its scripts only).
Read `AGENTS.md`, `handoff/SPEC.md` (§2 step 1, §4, §5, §8, §10) and `README.md` of both repos first. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local).
You MAY use `TFE_TOKEN`, `TFE_ORG`, `JEV_API_KEY` and (for fixtures pushes) your normal git access. Bind per command via exec `env` (`secret:org:TFE_TOKEN`, `secret:org:TFE_ORG`, `secret:org:JEV_API_KEY`) if not already in env. Never print, echo or commit values. Touch only the workspace `rerun-fixtures`. Never set `ENABLE_TF_OPERATIONS`.

## Owned paths
`fixtures/scenarios/<name>/{mcp/**,jev.json,expected.json,recording.json}` for all 11 scenarios, `fixtures/mcp/tools-list.json` (refresh only), `docs/RECORDING.md`. Copy `expected.json` from `rerun-fixtures/scenarios/<name>/expected.json` verbatim.

## Required behaviour
1. Start the real Terraform MCP server with `docker compose up -d terraform-mcp` (app repo) using your env token.
2. For each of the 11 scenarios in SPEC §10, sequentially: in the fixtures clone `scripts/break.sh <name>`; wait (poll via the MCP client `listRuns`, or the HCP Terraform API read-only on this workspace) until the run triggered by that commit is terminal (`errored` expected); `npm run record -- --scenario <name> --run <runId>`; record the live Jev triage answer with the W1-B recorder (`RERUN_RECORD=1`, Jev provider, the state built by `triage()` from the recorded artifacts) into `fixtures/scenarios/<name>/jev.json`; then `scripts/reset.sh` and wait for the baseline run to be `applied` before the next scenario.
3. Replace the hand-written placeholders (`apply-time-exit-1`, `undeclared-reference`) — remove every `"placeholder": true` marker.
4. Grep all recorded files for token patterns (`src/shared/redact.ts` regexes, plus `atlasv1`, `ghp_`, `github_pat_`, `sk-ant-`) — zero hits required; add a vitest `test/fixtures/redaction.test.ts` that asserts this for every file under `fixtures/`.
5. `docs/RECORDING.md`: table scenario → runId, run status, stage, Jev `failure_class` choice + probability, matches expected? (yes/no). Any scenario whose real Jev answer or real stage disagrees with `expected.json`: do not edit the fixtures repo's expectation; list it in the PR under "Expectation mismatches" for the orchestrator.
6. Leave the workspace on baseline with an `applied` run (last action = `reset.sh`).

## Tests
`npm test` (demo mode) still green with real fixtures — fix demo-mode tests that hard-coded placeholder values only if the fix is a fixture-path/value update, else list them in the PR.

## Done
PR title `W2-R: recorded MCP + Jev fixtures for 11 scenarios`. Do not merge. Report: PR URL, CI, the RECORDING table, mismatches.
