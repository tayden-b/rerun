# Task: Rerun — live quickstart gate with real credentials

Repos: app https://github.com/tayden-b/rerun (branch `work/g2-gate-live` off `dev`, PR into `dev`), fixtures https://github.com/tayden-b/rerun-fixtures (scripts only).
You are Tayden on his Mac, simulated: follow `docs/HANDOFF.md` and `README.md` live quickstart **literally**. You MAY use `RERUN_ANTHROPIC_API_KEY`, `JEV_API_KEY`, `TFE_TOKEN`, `TFE_ORG`, `GITHUB_TOKEN` (bind per command via exec `env` with `secret:org:<NAME>` if not present; write them into `.env` only in your local clone, which is gitignored — verify `git check-ignore .env` first). Never print, echo, commit or log values. Only the workspace `rerun-fixtures`. Never set `ENABLE_TF_OPERATIONS`. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local).

## Required behaviour
1. Fresh clone → `.env` → `docker compose up -d` → `npm ci && npm run db:migrate && npm run dev` → in a fresh fixtures clone `scripts/break.sh apply-time-exit-1` → watch `http://localhost:3000` (screenshot each state) → Approve in the UI → confirm `resolved`.
2. Record exact timings for each step (clone→dev ready, break→errored run, errored→incident created, →awaiting_approval, Approve→merged→applied→resolved) in the "Live quickstart timings" section of `docs/HANDOFF.md`.
3. Fix doc errors; file anything bigger as "Gaps for orchestrator".
4. Cleanup: `scripts/reset.sh`, workspace back on baseline `applied`; no open Rerun PRs left on `rerun-fixtures`.

## Done
Report: PR URL, timings table, screenshots, gaps.
