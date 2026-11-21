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

## Results (recorded 2026-11-21)

Class match = Jev `failure_class` and the recorded stage both equal `expected.json`. Route is `route()` (SPEC §4: `autoPr` iff `config_fixable ≥ 0.70`, `blast_radius ≤ 1.0`, `needs_human ≤ 0.40`).

| Scenario                    | Run                    | Status  | Stage | Jev `failure_class` (p)    | `config_fixable` | `blast_radius` | `needs_human` | Class + stage match? | Route                          | Expected route? |
| --------------------------- | ---------------------- | ------- | ----- | -------------------------- | ---------------- | -------------- | ------------- | -------------------- | ------------------------------ | --------------- |
| `missing-required-arg`      | `run-jLueoWCXwJt2cegf` | errored | plan  | `config_syntax` 1.00       | 0.97             | 0.03           | 0.49          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `undeclared-reference`      | `run-U1QwgjkB6QN4gFMp` | errored | plan  | `config_reference` 1.00    | 0.96             | 0.01           | 0.43          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `unset-variable`            | `run-eDQhbs9n5UT8SdT5` | errored | plan  | `missing_input` 1.00       | 0.59             | 0.00           | 0.56          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `provider-version-conflict` | `run-MmCfDwGHL3MAyoCX` | errored | init  | `provider_version` 1.00    | 0.68             | 0.00           | 0.63          | yes                  | `draftPr` (expected `draftPr`) | yes             |
| `removed-argument`          | `run-f6PFRnpTd5jc81ZH` | errored | plan  | `config_syntax` 1.00       | 0.94             | 0.06           | 0.25          | yes                  | `autoPr` (expected `autoPr`)   | yes             |
| `http-404-postcondition`    | `run-v3GYTqfHnnLEx3s6` | errored | plan  | `precondition_failed` 0.98 | 0.73             | 0.02           | 0.69          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `check-block-failure`       | `run-R9mrUiPCcNQSC8Sk` | errored | plan  | `precondition_failed` 1.00 | 0.83             | 0.06           | 0.77          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `dependency-cycle`          | `run-CqmHS2iCcM5PzQCu` | errored | plan  | `dependency_cycle` 1.00    | 0.88             | 0.14           | 0.69          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `module-source-typo`        | `run-5ELJM53ncPGwyXn1` | errored | init  | `module_source` 0.96       | 0.78             | 0.00           | 0.55          | yes                  | `draftPr` (expected `draftPr`) | yes             |
| `apply-time-exit-1`         | `run-3ytwwidAGVQdc3HA` | errored | apply | `apply_runtime` 1.00       | 0.88             | 0.95           | 0.69          | yes                  | `draftPr` (expected `autoPr`)  | no              |
| `bad-http-url`              | `run-uDw5DwqRNor1grxR` | errored | plan  | `provider_api_error` 1.00  | 0.77             | 0.01           | 0.56          | yes                  | `draftPr` (expected `autoPr`)  | no              |

Class and stage match `expected.json` for all 11. Routes match for 3 of 11: live Jev puts `needs_human` above 0.40 in 10 scenarios (all but `removed-argument`) (and `config_fixable` below 0.70 for `unset-variable` and `provider-version-conflict`), so 8 scenarios expected to reach `autoPr` route to `draftPr`. Questions and thresholds are unchanged.
