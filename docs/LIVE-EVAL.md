# Live end-to-end eval (W2-L)

Each scenario was broken on the real HCP Terraform workspace `rerun-fixtures` with `scripts/break.sh <name>`, run through
Rerun (real Terraform MCP, Jev, Anthropic, Docker verifier, GitHub), then cleaned up: PR closed, `rerun/*` branch deleted,
`scripts/reset.sh`, baseline `applied`. Scenarios ran one at a time. Machine-readable rows are in `evals/results.json`
(`live.rows`, `live.resolve`); the README table is generated from them by `npm run eval:readme`.

Run it: `docker compose up -d`, `npm run db:migrate`, `npm run dev`, then
`npm run eval -- --live --live-only --scenarios <name>` (or `npm run eval -- --live` for all 11). The eval starts incidents
through `POST /api/incidents` on the running app (`RERUN_APP_URL`, default `http://localhost:$PORT`) and drives the fixtures
checkout at `RERUN_FIXTURES_DIR` (default `../rerun-fixtures`).

## Results: 9 of 11 pass, 2 blocked

| Scenario                  | Class expected → actual                   | Route expected → actual | Reached status                                 | Verifier | PR                                                                | fixTouches respected | Incident duration | Tokens in / out | Cost   |
| ------------------------- | ----------------------------------------- | ----------------------- | ---------------------------------------------- | -------- | ----------------------------------------------------------------- | -------------------- | ----------------- | --------------- | ------ |
| missing-required-arg      | config_syntax → config_syntax             | autoPr → autoPr         | awaiting_approval                              | pass     | [#9](https://github.com/tayden-b/rerun-fixtures/pull/9)           | yes                  | 58 s              | 37,491 / 998    | $0.082 |
| undeclared-reference      | config_reference → config_reference       | autoPr → autoPr         | awaiting_approval                              | pass     | [#10](https://github.com/tayden-b/rerun-fixtures/pull/10)         | yes                  | 64 s              | 26,120 / 767    | $0.057 |
| unset-variable            | missing_input → missing_input             | autoPr → autoPr         | awaiting_approval                              | pass     | [#11](https://github.com/tayden-b/rerun-fixtures/pull/11)         | yes                  | 54 s              | 25,600 / 883    | $0.057 |
| provider-version-conflict | provider_version → provider_version       | draftPr → draftPr       | awaiting_approval (needsHuman)                 | pass     | [#12](https://github.com/tayden-b/rerun-fixtures/pull/12) (draft) | yes                  | 60 s              | 53,262 / 1,518  | $0.119 |
| removed-argument          | config_syntax → config_syntax             | autoPr → autoPr         | awaiting_approval                              | pass     | [#13](https://github.com/tayden-b/rerun-fixtures/pull/13)         | yes                  | 48 s              | 26,902 / 938    | $0.060 |
| http-404-postcondition    | precondition_failed → precondition_failed | autoPr → autoPr         | awaiting_approval                              | pass     | [#14](https://github.com/tayden-b/rerun-fixtures/pull/14)         | yes                  | 52 s              | 26,182 / 1,014  | $0.060 |
| check-block-failure       | precondition_failed → precondition_failed | autoPr → autoPr         | awaiting_approval                              | pass     | [#15](https://github.com/tayden-b/rerun-fixtures/pull/15)         | yes                  | 54 s              | 33,310 / 925    | $0.073 |
| dependency-cycle          | dependency_cycle → dependency_cycle       | autoPr → autoPr         | awaiting_approval                              | pass     | [#16](https://github.com/tayden-b/rerun-fixtures/pull/16)         | yes                  | 52 s              | 27,236 / 1,049  | $0.062 |
| module-source-typo        | module_source → module_source             | draftPr → draftPr       | awaiting_approval (needsHuman)                 | pass     | [#17](https://github.com/tayden-b/rerun-fixtures/pull/17) (draft) | yes                  | 50 s              | 25,990 / 788    | $0.057 |
| apply-time-exit-1         | apply_runtime → —                         | autoPr → —              | **blocked: Anthropic credit balance**          | —        | —                                                                 | —                    | —                 | —               | —      |
| bad-http-url              | provider_api_error → provider_api_error   | autoPr → autoPr         | **blocked: Anthropic credit balance** (failed) | —        | —                                                                 | —                    | 14 s              | 1,431 / 0       | $0.000 |

Per scenario the break phase (push → errored run) took 26–44 s and the reset phase (push → `applied`) 37–60 s; both are in
`phasesMs` in `evals/results.json`. All 9 PRs were closed and their branches deleted after each row was recorded.

### Blocked

Both blocked rows and the approve → resolved run fail on the same outside dependency, not on Rerun:

- **Error class:** `AI_APICallError` (HTTP 400, `invalid_request_error`): "Your credit balance is too low to access the
  Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
- **Key:** `RERUN_ANTHROPIC_API_KEY` (the org `ANTHROPIC_API_KEY` is not authorised for this project and was not used).
- **`bad-http-url`:** first seen 2026-11-21T02:47:30.584Z. Jev triage was correct (`provider_api_error`, confidence 1,
  route `autoPr`); the Config/Reality diagnosers and all Fix attempts then failed on the credit error, so no PR.
- **`apply-time-exit-1`:** the first attempt (2026-11-21T02:45) failed for an eval-side reason, now fixed (bug 3 below).
  The re-run is blocked by the credit balance (probe at 2026-11-21T02:52:50Z).
- **Approve → resolved (`apply-time-exit-1`):** blocked; it needs the scenario's PR first. `evals/resolve.ts` runs it
  (break → errored → incident → `POST /api/incidents/<id>/approve` → merge → Actions apply → next run `applied` →
  `resolved`) and records each phase.

No scenario is impossible as specified.

## Bugs fixed

1. **The eval could not start a workflow.** Calling `startIncident()` from the eval CLI failed with
   `WorkflowRuntimeError: 'start' received an invalid workflow function`: Workflow SDK workflows only exist inside the
   Next process that `withWorkflow` compiled. Added `POST /api/incidents` (`{ runId }` → 201 new, 200 already started,
   400 bad run id) and the eval starts incidents through it. Tests: `test/integration/live-eval.test.ts`.
2. **Speculative runs were taken for the break run.** The verifier's and the PR check's speculative plans land on the
   same workspace, so "the next run" after a push was sometimes a `plan_only` run. The fixtures driver now ignores
   `plan_only` runs. Tests: `test/integration/live-eval.test.ts`.
3. **SQLite `SQLITE_BUSY` across processes.** The eval read `incident_events` while the app was writing and got
   `Failed query: select ... from incident_events` (`SQLITE_BUSY`) at once. The runner then cleaned up mid-incident:
   `reset.sh` pushed the baseline while the incident was still running, so the Fix agent read the reset `main.tf`, found
   no `exit 1` and made no change (`apply-time-exit-1`, first attempt). `openDb` now sets the libSQL client `timeout`
   (busy timeout, 5 s, on every pooled connection). Test: `src/db/busy.test.ts` (another process holds the write lock).
4. **Duplicate incidents for one run (assigned).** The poller, the webhook and the eval can all start the same run.
   `incidents.run_id` now has a unique index (`drizzle/0001_incidents_run_id_unique.sql`), and `startIncident` treats a
   unique violation as "already started": it returns the existing incident with `created: false` and starts no second
   workflow. Test: `test/integration/start-race.test.ts`.

Eval tooling (not app bugs): `--live-only` fills the live table one scenario at a time and keeps the provider tables;
live rows now record class, route, draft, tokens, cost and phase timings, and a `blocked` reason.

## Observations (not changed)

- The Fix agent edits the tip of `main`, not the commit of the failed run. If `main` moves during an incident (as in bug 3),
  the agent can see a different revision from the one that failed.
- `apply-time-exit-1` blast radius sits at the 1.0 limit; its live route is not yet observed (blocked).
- No UI bugs found; the UI was not part of this run.
