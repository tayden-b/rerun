# Recording scenario fixtures

All 11 seeded scenarios (SPEC §10) are recorded from the real `errored` HCP Terraform runs that W0-B produced on workspace `rerun-fixtures` (run ids from `rerun-fixtures/scenarios/RESULTS.md`), plus a live Jev triage answer for each. No scenario needed the slow path (break → wait → record → reset).

## How to re-record

1. Start the real server: `TFE_TOKEN=... docker compose up -d terraform-mcp`.
2. MCP outputs, one scenario at a time (running all 11 in parallel trips the server's global rate limit):
   `TFE_ORG=... npm run record -- --scenario <name> --run <runId>`
   writes `fixtures/scenarios/<name>/mcp/*.json` and `recording.json`.
3. Jev answers: `JEV_API_KEY=... npm run record:jev [-- --scenario <name>]`
   serves the recorded `mcp/**` from the in-process mock server, runs `collectRunArtifacts` for the recorded run id, calls `triage()` with `JevDecisionProvider` and writes `jev.json` through `recordDecision` (`RERUN_RECORD=1` is set by the npm script).
4. `expected.json` is copied verbatim from `rerun-fixtures/scenarios/<name>/expected.json`.
5. `docker compose down`.

`test/fixtures/redaction.test.ts` fails if any file under `fixtures/` matches a `src/shared/redact.ts` pattern or contains `atlasv1`, `ghp_`, `github_pat_` or `sk-ant-`.

## Results (re-recorded 2026-11-21, calibrated questions)

MCP outputs are the 2026-11-21 recordings; `jev.json` was re-recorded with `npm run record:jev` after the `config_fixable`, `blast_radius` and `needs_human` instructions in `src/decisions/questions.ts` were rewritten (W2-J). Class match = Jev `failure_class` and the recorded stage both equal `expected.json`. Route is `route()` (SPEC §4: `autoPr` iff `config_fixable ≥ 0.70`, `blast_radius ≤ 1.0`, `needs_human ≤ 0.40`; thresholds unchanged).

| Scenario                    | Run                    | Status  | Stage | Jev `failure_class` (p)    | `config_fixable` | `blast_radius` | `needs_human` | Class + stage match? | Route                          | Expected route? |
| --------------------------- | ---------------------- | ------- | ----- | -------------------------- | ---------------- | -------------- | ------------- | -------------------- | ------------------------------ | --------------- |
| `missing-required-arg`      | `run-jLueoWCXwJt2cegf` | errored | plan  | `config_syntax` 1.00       | 0.98             | 0.10           | 0.19          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `undeclared-reference`      | `run-U1QwgjkB6QN4gFMp` | errored | plan  | `config_reference` 1.00    | 0.97             | 0.02           | 0.18          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `unset-variable`            | `run-eDQhbs9n5UT8SdT5` | errored | plan  | `missing_input` 1.00       | 0.95             | 0.00           | 0.30          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `provider-version-conflict` | `run-MmCfDwGHL3MAyoCX` | errored | init  | `provider_version` 1.00    | 0.85             | 0.00           | 0.79          | yes                  | `draftPr` (expected `draftPr`) | yes             |
| `removed-argument`          | `run-f6PFRnpTd5jc81ZH` | errored | plan  | `config_syntax` 1.00       | 0.96             | 0.06           | 0.12          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `http-404-postcondition`    | `run-v3GYTqfHnnLEx3s6` | errored | plan  | `precondition_failed` 0.98 | 0.92             | 0.03           | 0.26          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `check-block-failure`       | `run-R9mrUiPCcNQSC8Sk` | errored | plan  | `precondition_failed` 1.00 | 0.95             | 0.03           | 0.29          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `dependency-cycle`          | `run-CqmHS2iCcM5PzQCu` | errored | plan  | `dependency_cycle` 1.00    | 0.92             | 0.13           | 0.16          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `module-source-typo`        | `run-5ELJM53ncPGwyXn1` | errored | init  | `module_source` 0.97       | 0.79             | 0.00           | 0.52          | yes                  | `draftPr` (expected `draftPr`) | yes             |
| `apply-time-exit-1`         | `run-3ytwwidAGVQdc3HA` | errored | apply | `apply_runtime` 1.00       | 0.92             | 1.00           | 0.29          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `bad-http-url`              | `run-uDw5DwqRNor1grxR` | errored | plan  | `provider_api_error` 1.00  | 0.90             | 0.03           | 0.31          | yes                  | `autoPr` (expected `autoPr`)   | yes             |

Class and stage match `expected.json` for all 11, and routes match for all 11 (before the rewrite: 3 of 11). `test/decisions/recorded.test.ts` asserts both.

What changed in the questions (no scenario, resource, file or error text appears in them; `test/decisions/questions.test.ts` checks this):

- `config_fixable` lists what a `.tf`/`.tfvars` edit can do (arguments, references, URLs, commands, values, defaults, tfvars values, version constraints, module sources) and what it cannot (credentials or secret values, quota or permissions, systems outside Terraform). A configured value that an endpoint, command or assertion rejects counts as fixable.
- `needs_human` asks whether a person must supply information or a decision that cannot be derived from the repository, logs, plan, state and provider docs. It states that every fix is a reviewed PR, so review and "several equivalent fixes" are not reasons for yes. Yes cases: credentials or secrets, a choice between materially different outcomes, accepting destruction of stateful data, changes outside Terraform, and any change to a module source or provider/Terraform version constraint (it changes which dependency code is installed). That last rule is why the two init-stage scenarios stay `draftPr` while config-only corrections reach `autoPr`.
- `blast_radius` says to judge from the plan summary, and that replacing a resource holding no data is the second level ("Only stateless or trivially recreatable resources", score 1), not higher.

Margins to watch: `apply-time-exit-1` has `blast_radius` 1.00, exactly at the `≤ 1.0` limit (the plan replaces one data-less resource, so the honest answer is level 1); any probability on a higher level routes it to `draftPr`. The LLM provider (`claude-haiku-5-5`, which ignores `temperature`) does this in the eval: 1.02, so its route accuracy is 10 of 11.
