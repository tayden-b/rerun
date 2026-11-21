# Task: Rerun — integration gate (demo mode, docs only)

Repo: https://github.com/tayden-b/rerun — branch `work/g1-gate-demo` off `dev`, PR into `dev` (only if you change anything).
You are a new user on a clean VM. Follow `README.md` **literally**, from the docs alone, in demo mode: `git clone`, `npm ci`, `npm run build`, `npm test`, `npm run demo`, open the dashboard, run the Playwright smoke (`npm run test:e2e`). Do not read the code to work around a doc gap until you have written the gap down. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local). No credentials.

## Required behaviour
1. Log every step with its exact command, outcome and wall-clock time in `docs/GATE-DEMO.md`.
2. Fix doc errors and small breakages directly (doc fixes, missing scripts, wrong paths). Anything bigger than ~30 lines of code: file it in the PR description under "Gaps for orchestrator" with the exact repro.
3. Repeat from a fresh clone until a clean pass needs no fixes.

## Done
Report: PR URL (if any), the step table, gaps.
