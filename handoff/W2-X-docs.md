# Task: Rerun — README and docs

Repo: https://github.com/tayden-b/rerun — branch `work/w2x-docs` off `dev`, PR into `dev`.
Read `AGENTS.md`, `handoff/SPEC.md`, the code, `docs/RECORDING.md`, `docs/LIVE-EVAL.md` (if present) and `evals/results.json` first. Git identity: Tayden Barretto <taydenpbarretto@gmail.com> (repo-local). No credentials.

## Owned paths
`README.md` (everything except the `<!-- evals:start -->…<!-- evals:end -->` section, which `npm run eval:readme` renders — run it, don't hand-edit), `docs/ARCHITECTURE.md`, `docs/EXTENDING.md`, `.env.example` comments only.

## Required behaviour
README, in this order, plain and concise (audience: HashiCorp customers' platform engineers and hiring managers; no marketing taglines, no emoji):
1. What Rerun is (2–3 sentences) + the GIF (`docs/media/rerun.gif`).
2. Why MCP: every piece of Terraform data comes through the Terraform MCP server's read-only tools (list them), scoped to one workspace; what that buys a customer.
3. Architecture: one Mermaid diagram (poll/webhook → workflow steps → MCP / Jev / agents / verifier / GitHub → dashboard), and a short table of modules and their responsibility.
4. Evals: the rendered table section (run `npm run eval:readme`), plus 3 sentences on how to read it (triage accuracy, calibration, robustness flip rate, live e2e).
5. Quickstart: demo mode (`npm ci && npm run demo`, zero credentials) and live mode (`.env` from `.env.example`, `docker compose up -d`, `npm run db:migrate`, `npm run dev`, break a scenario in the fixtures repo) — every command copy-pasteable and verified by you in demo mode.
6. How a customer would extend this: add a failure class, add a scenario, swap Jev/LLM, swap the verifier (Vercel Sandbox), add Slack — each 2–3 lines pointing at the file.
7. Security model: allowlisted tools, workspace scope guard, no `ENABLE_TF_OPERATIONS`, human approval = merge, secret redaction.
Never include personal URLs, org-specific deployment URLs or secret values.

## Done
PR title `W2-X: README, architecture, extending docs`. Do not merge. Report: PR URL, CI, and any command in the quickstart that did not work as documented.
