# Task: Rerun — live end-to-end eval against the real workspace; fix what breaks

Repos: app https://github.com/tayden-b/rerun (branch `work/w2l-live-eval` off `dev`, PR into `dev`) and fixtures https://github.com/tayden-b/rerun-fixtures (scenario commits via its scripts only; Rerun's own PRs).
Read `AGENTS.md`, `handoff/SPEC.md` (all), `README.md`, `docs/RECORDING.md` and the merged integration code first. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local).
You MAY use `RERUN_ANTHROPIC_API_KEY`, `JEV_API_KEY`, `TFE_TOKEN`, `TFE_ORG`, `GITHUB_TOKEN` from your env (bind per command via exec `env` with `secret:org:<NAME>` if not present). Never print, echo, commit or log values. Touch only the HCP Terraform workspace `rerun-fixtures` and the GitHub repo `tayden-b/rerun-fixtures`. Never set `ENABLE_TF_OPERATIONS`. Docker is required (MCP server + verifier).

## Owned paths
Any file in the app repo needed to fix a real-world bug the live run exposes (expect 2–4: tool argument names, log formats, timing, GitHub API details), plus `evals/results.json`, `docs/LIVE-EVAL.md`. Keep each fix minimal and covered by a demo-mode regression test using a recorded fixture of the real failure.

## Required behaviour
1. `docker compose up -d`, `npm ci`, `npm run db:migrate`.
2. `npm run eval -- --live` (wire anything still missing in `runLiveScenario` so it: `break.sh <name>` → waits for the errored run → `startIncident` → waits for the incident to reach `awaiting_approval`/`needs_human`/`failed` → records `reachedStatus`, `verifierOk`, `prUrl`, `fixTouches` respected, `durationMs`; then closes the PR and deletes its branch, `reset.sh`, waits for `applied`).
3. Iterate on failures until **every one of the 11 scenarios reaches `awaiting_approval` (or `needs_human` with a draft PR for `draftPr` routes) with a passing verifier and an open PR**. Fix root causes, not the scenarios. If a scenario is genuinely impossible as specified, document why in `docs/LIVE-EVAL.md` and the PR (do not silently drop it).
4. Then take one scenario (`apply-time-exit-1`) all the way: `POST /api/incidents/<id>/approve` → PR merged on `rerun-fixtures` → Actions apply → Rerun sees the next run `applied` → incident `resolved`. Record timings for every phase.
5. Results: `evals/results.json` with the live rows; `npm run eval:readme`; `docs/LIVE-EVAL.md` with the table (scenario, class expected/actual, route, verifier, PR opened, fixTouches respected, duration, tokens/cost) and the bugs fixed.
6. Cleanup: close every PR and delete every `rerun/*` branch Rerun opened on `rerun-fixtures` (except the merged one), `scripts/reset.sh`, confirm the workspace is on baseline with an `applied` run.

## Done
PR title `W2-L: live eval — 11/11 scenarios, fixes`. Do not merge. Report: PR URL, CI, the results table, the bugs fixed, and the resolved incident's timings.
