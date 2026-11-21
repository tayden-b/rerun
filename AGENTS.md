# Rerun — worker rules

Every worker (human or agent) follows these rules. The orchestrator reviews and merges; you never merge.

## Before you start

1. Read `handoff/SPEC.md` in full. It is the source of truth; never edit it or anything under `handoff/`.
2. Read your brief in `handoff/<task>.md` and the `README.md` of every directory you will touch.
3. Branch `work/<task-slug>` off `dev`, one branch and one PR into `dev`. Do not create or push to `main`. Do not merge.

## Owned paths

Touch only the paths your brief assigns. Everything else is read-only; if you need a change there, say so in your PR.

| Path                                                                                      | Owner  |
| ----------------------------------------------------------------------------------------- | ------ |
| `src/shared/**`, `src/config.ts`, `src/models.ts`, `src/db/**`, `drizzle/**`, tooling, CI | W0-A   |
| `fixtures/scenarios/*/expected.json`, fixture workspace                                   | W0-B   |
| `src/mcp/**`, `fixtures/scenarios/*/mcp/**`                                               | W1-A   |
| `src/decisions/**`, `src/agents/triage.ts`, `fixtures/scenarios/*/jev.json`               | W1-B   |
| `src/agents/**` except `triage.ts`                                                        | W1-C   |
| `src/verify/**`, `src/github/**`, `src/watch/**`                                          | W1-D   |
| `app/**` pages and layouts, `components/**`                                               | W1-E   |
| `src/telemetry/**`, `evals/**`                                                            | W1-F   |
| `app/api/**`, `workflows/**`                                                              | Wave 2 |

`src/shared/types.ts` is SPEC §11 verbatim. Changing a contract goes through the orchestrator, never a worker PR.

## Hard rules

- **Demo mode in tests.** `vitest.config.mts` forces `RERUN_MODE=demo`. `npm test` and CI never touch HCP Terraform, GitHub, Jev, or Anthropic.
- **No secret values** anywhere: code, fixtures, logs, PR text. Pass anything that may hold a token through `redact()` from `src/shared/redact.ts` before storing or displaying it.
- **`TFE_TOKEN` is used in exactly two places:** the `terraform-mcp` sidecar (all reads of HCP Terraform go through MCP) and the Docker verifier, which forwards it by variable name into the container as `TF_TOKEN_app_terraform_io` for the speculative plan. Nothing else reads it.
- **Live tests** are named `*.live.test.ts`, excluded from `npm test`, and run with `npm run test:live`. They fail (not skip) when a required key is missing. No `runIf`/`skipIf` gating.
- The app's Anthropic key is `RERUN_ANTHROPIC_API_KEY` (falls back to `ANTHROPIC_API_KEY` only when unset).
- **No suppressions.** No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `it.skip`, `.only`, or scanner ignores. Fix the cause.
- **Pinned dependencies.** `.npmrc` sets `save-exact=true`. Add packages with `npm i <pkg>@<version>` and commit `package-lock.json`.
- Guard every live-only code path with `requireLive([...])` from `src/config.ts`.
- CI (`.github/workflows/ci.yml`) must stay green: `npm ci`, lint, typecheck, test, build on Node 24.

## Commands

| Command                                             | What it does                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev`                                       | Next dev server (live mode unless `RERUN_MODE=demo`)                                             |
| `npm run demo`                                      | `RERUN_MODE=demo`, mock MCP on :8080 in-process, seeds a placeholder incident, Next dev on :3000 |
| `npm run mock-mcp`                                  | Mock Terraform MCP server only, `http://127.0.0.1:8080/mcp` (`?scenario=` or `MOCK_SCENARIO`)    |
| `npm run lint`                                      | ESLint + Prettier check (`npm run format` writes)                                                |
| `npm run typecheck`                                 | `next typegen` (route/layout types such as `LayoutProps`), then `tsc --noEmit`                   |
| `npm test`                                          | Vitest: `src/**/*.test.ts`, `test/**/*.test.ts`                                                  |
| `npm run build`                                     | Production `next build`                                                                          |
| `npm run db:migrate`                                | `drizzle-kit generate`, then apply migrations to `DATABASE_URL`                                  |
| `npm run eval`, `eval:readme`, `record`, `test:e2e` | Stubs that exit 1 until W1-F / W0-B / W1-E implement them                                        |
| `docker compose up terraform-mcp`                   | Real Terraform MCP server on `127.0.0.1:8080` (needs `TFE_TOKEN`)                                |

## Environment

Every variable is listed in `.env.example` and parsed in `src/config.ts` (SPEC §9).

- `RERUN_ANTHROPIC_API_KEY` is accepted as an alias for `ANTHROPIC_API_KEY`; `ANTHROPIC_API_KEY` wins when both are set.
- `RERUN_MODE` is `live` (default) or `demo`.
- `DATABASE_URL` defaults to `file:data/rerun.db`; `data/` is gitignored. Tests use `file::memory:`.
- `NEXT_DIST_DIR` overrides `.next` so a test dev server does not collide with your own `npm run dev`.

## Pinned versions (verified together)

`next@16.4.6`, `workflow@5.7.1`, `ai@6.0.333`, `@ai-sdk/anthropic@3.0.143`, `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `@libsql/client@0.18.0`, `@modelcontextprotocol/sdk@1.32.2`, `hashicorp/terraform-mcp-server:1.4`.
`withWorkflow` from `workflow/next` works with Next 16.4.6 under both `next dev` and `next build`.

## Workflow SDK gotchas

- Project convention: workflows (`"use workflow"`) live in `workflows/`; start them with `start(fn, [args])` from `workflow/api` and read them with `getRun(runId)`.
- Workflow bodies run in a sandbox without Node.js APIs and are replayed, so they must be deterministic. `Date` and `Math.random` are fixed by the sandbox; all I/O (DB, MCP, GitHub, LLM calls) goes in `"use step"` functions.
- Step arguments and return values must be serialisable (plain JSON, Date, Map/Set). No class instances, DB clients, or functions.
- `withWorkflow` generates `app/.well-known/workflow/**` at dev/build time. It is gitignored and lint-ignored; never edit or commit it.
- Outside Vercel the Local World is used. Its state lives in `.workflow-data/` (gitignored); set `WORKFLOW_LOCAL_DATA_DIR` to isolate test runs.
- `@libsql/client` is listed in `serverExternalPackages` so native bindings are not bundled.

## Terraform MCP server gotchas

- Select the transport with the `streamable-http` subcommand. In 1.4.x, setting `TRANSPORT_MODE` in the environment makes the server ignore `--tools` and enable all toolsets, so `docker-compose.yml` uses the subcommand plus `--transport-host`/`--transport-port` flags instead.
- The endpoint is `/mcp`. The tool allowlist is `src/mcp/allowlist.ts` (SPEC §5); keep it identical to the `--tools` list in `docker-compose.yml`.

## Next.js 16

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
