# Task: Rerun — app scaffold, contracts, CI, demo-mode skeleton

Repo: https://github.com/tayden-b/rerun — branch `dev` exists and contains only `handoff/` (the spec and all worker briefs). Work on `work/w0a-scaffold` off `dev` and open a PR into `dev`. Do not create `main`.
Model: judgment. Git identity: `git config user.name "Tayden Barretto" && git config user.email "taydenpbarretto@gmail.com"`.

The specification is `handoff/SPEC.md` on `dev` — read it fully first; it is the source of truth for every later worker. Never edit it in this task.

## Required behaviour
Produce a Next.js 16 (App Router, TypeScript strict, Tailwind, shadcn/ui initialised, dark theme default) application skeleton that later workers extend in parallel without touching each other's files. Nothing here needs network credentials.

1. **Layout** (create every directory with a `README.md` one-liner describing its owner so parallel workers know the boundaries):
   - `app/` (pages + API routes; W1-E owns pages, Wave 2 owns `app/api/**`), `components/` (W1-E), `workflows/` (Wave 2), `src/shared/` (you), `src/config.ts` (you), `src/db/` (you), `src/mcp/` (W1-A), `src/decisions/` + `src/agents/triage.ts` (W1-B), `src/agents/` others (W1-C), `src/verify/` + `src/github/` (W1-D), `src/telemetry/` + `evals/` (W1-F), `fixtures/` (W1-A owns `fixtures/scenarios/*/mcp`, W1-B owns `fixtures/scenarios/*/jev.json`), `scripts/`, `docs/`, `test/`.
2. **Contracts**: `src/shared/types.ts` = SPEC §11 verbatim. `src/shared/redact.ts`: `redact(text)` masking HCP Terraform tokens (`[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}`), GitHub PATs (`gh[pous]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{80,}`), Anthropic keys (`sk-ant-[A-Za-z0-9_-]{20,}`), bearer headers; unit-tested. `src/shared/excerpt.ts`: `extractErrorExcerpt(log)` per SPEC §4, unit-tested with a sample Terraform plan log you write.
3. **Config**: `src/config.ts` reads every env var in SPEC §9 with defaults, accepts `RERUN_ANTHROPIC_API_KEY` as an alias for `ANTHROPIC_API_KEY`, exposes `config.mode` (`live|demo`), and a `requireLive()` guard that throws a clear error listing missing vars. `.env.example` with every var and a comment, no values.
4. **DB**: Drizzle + `@libsql/client`, schema for SPEC §6 in `src/db/schema.ts`, `src/db/index.ts` client, `drizzle.config.ts`, `npm run db:migrate` (generates + applies to `DATABASE_URL`), `data/` gitignored. A tiny repository layer `src/db/incidents.ts` with `createIncident`, `setStatus`, `appendEvent` (auto-incrementing `seq` per incident), `listIncidents`, `getIncident(id)` (with events, decisions, artifacts), `addArtifact`, `addDecision`. Unit tests on an in-memory libSQL (`file::memory:`).
5. **Workflow SDK**: `npm i workflow` and wrap `next.config.ts` with `withWorkflow` from `workflow/next`; add a trivial `workflows/ping.ts` (`"use workflow"` calling one `"use step"`) and `app/api/ping/route.ts` that starts it, so the Local World is proven to work in `npm run dev` and in a vitest integration test that starts the Next dev server, POSTs, and sees the step complete. If `withWorkflow` breaks the build on Next 16.x, pin the versions that work and record them in `AGENTS.md`.
6. **AI SDK**: install `ai@^6`, `@ai-sdk/anthropic`, `zod`; `src/models.ts` exporting `agentModel()` / `fastModel()` built from `config` (plain model-id strings so a Gateway swap is one line).
7. **Mock MCP server stub**: `src/mcp/mock/server.ts` — a minimal MCP streamable-HTTP server (`@modelcontextprotocol/sdk`) that registers the SPEC §5 tool names and returns `fixtures/scenarios/<scenario>/mcp/<tool>.json` if present, else a structured "no fixture" error; `npm run mock-mcp` starts it on 8080. W1-A replaces the internals; keep the file names.
8. **Demo mode**: `npm run demo` sets `RERUN_MODE=demo`, starts the mock MCP server in-process and the Next dev server. Seed `fixtures/scenarios/apply-time-exit-1/` with hand-written, realistic placeholder files (`mcp/get_run_details.json`, `mcp/get_apply_logs.json`, `mcp/get_plan_json_output.json`, `jev.json`, `expected.json`) so the UI worker has something to render; mark them `"placeholder": true`.
9. **Docker**: `docker-compose.yml` with the `terraform-mcp` service (`hashicorp/terraform-mcp-server:1.4`, `TRANSPORT_MODE=streamable-http`, `TRANSPORT_HOST=0.0.0.0`, `TRANSPORT_PORT=8080`, `TFE_TOKEN`/`TFE_ADDRESS=https://app.terraform.io` from env, `--tools` set to the SPEC §5 allowlist as the command args; verify the flag syntax from `docker run --rm hashicorp/terraform-mcp-server:1.4 --help`), port `127.0.0.1:8080:8080`, no restart policy. Do not start it with real tokens in CI.
10. **Tooling**: `npm run lint` (eslint + prettier check), `npm run typecheck`, `npm test` (vitest; `src/**/*.test.ts`, `test/**/*.test.ts`), `npm run build`. Pre-create the npm scripts for later workers (implementations may be stubs that exit 1 with "not implemented"): `eval`, `eval:readme`, `record`, `mock-mcp`, `demo`, `db:migrate`, `test:e2e`. 
11. **CI**: `.github/workflows/ci.yml` on every PR and push to `dev`: `npm ci`, lint, typecheck, test, build — all in demo mode, no secrets. Node 24.
12. **`AGENTS.md`** at repo root: the rules every worker must follow (read SPEC first; one branch + one PR; do not merge; owned paths; demo mode in tests; no secret values; no suppressions; commands table; env aliases; Workflow SDK gotchas you hit). Keep it under 120 lines.
13. **`docs/BUILD-STATUS.md`** skeleton (wave table, open issues, decisions made) and empty `docs/HANDOFF.md` with headings.

## Tests
- redact: each token family masked; normal text untouched.
- excerpt: a 400-line log → ≤120 lines, contains the `Error:` block, redacted.
- db: create → appendEvent ×3 → getIncident returns events in seq order; setStatus persists.
- workflow ping integration test passes locally and in CI.
- `npm run build` succeeds; `npm run demo` serves `/` (a placeholder page listing the seeded incident from the DB is fine).

## Guardrails
- No credentials needed or used. Do not read `RERUN_ANTHROPIC_API_KEY`, `JEV_API_KEY`, `TFE_TOKEN`, or `GITHUB_TOKEN` even if present in your environment.
- No scanner/lint/test suppressions. No sub-agents. Pin dependency versions (`save-exact`).
- If `workflow` + Next 16 cannot be made to work after a genuine attempt, report exactly what fails in the PR and keep the rest shippable.

## Done
- CI green on the PR. PR title `W0-A: app scaffold, contracts, CI, demo-mode skeleton`. **Do not merge.** Report: PR URL, CI status, versions pinned (Next, workflow, ai, drizzle), and anything in the spec that proved impossible as written.
