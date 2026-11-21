# Rerun — Specification (source of truth)

**One line.** When an HCP Terraform run fails, Rerun diagnoses it through the Terraform MCP server, decides with a typed decision model (Jev) how serious and how fixable it is, writes the smallest fix, proves the fix with a real speculative plan, opens the PR, and shows the whole investigation in a dashboard where a human approves the merge.

**Why it exists.** A demo for HashiCorp customers of what a platform team can build on the Terraform MCP server in a weekend: every piece of data Rerun uses comes through MCP tools a customer could configure themselves. It is also a portfolio artifact for Tayden, so the README, the UI and the eval numbers matter as much as the code.

Repos (both public, owner `tayden-b`):
- `rerun` — the app (this spec lives in `handoff/SPEC.md`). Base branch `dev`; `main` is created only at the very end by the orchestrator as a snapshot.
- `rerun-fixtures` — a Terraform configuration with seeded failure scenarios; the HCP Terraform workspace `rerun-fixtures` in org `hashi-org-TF` applies it; Rerun's fix PRs target this repo. Base branch `main` (the Actions workflow applies from `main`).

## 1. Settled decisions (do not re-open)

| Area | Decision |
|---|---|
| Language / runtime | TypeScript strict, Node 24, npm (lockfile committed). No other package managers, no monorepo tooling. |
| App | Next.js 16 App Router, Tailwind, shadcn/ui, **AI Elements from shadcn/ui** (`https://ui.shadcn.com/docs/ai-elements`; not the deprecated `ai-elements` CLI). Dark theme by default. |
| Agents | **AI SDK 6** (`ai` ^6): `ToolLoopAgent` for the diagnosis and fix agents; `generateObject`/structured output where a single call is enough. Provider: `@ai-sdk/anthropic` directly (no AI Gateway in this iteration — but model ids are plain strings in one config file so the Gateway swap later is a one-line change). Models: `claude-sonnet-5-5` for agents, `claude-haiku-5-5` for summaries. |
| Decisions | **Jev** (TypeSafe System One API, `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $JEV_API_KEY`, model `jev-latest`) behind a `DecisionProvider` interface. A second implementation `LlmDecisionProvider` (Claude structured output) exists for comparison in evals and as a fallback when `JEV_API_KEY` is unset. |
| Orchestration | **Workflow SDK 5** (`workflow` ^5, `workflow/next`): one `"use workflow"` function per incident; steps are plain async functions with `"use step"`. Local World (SQLite) in dev/CI; no Vercel in this iteration. |
| Terraform data | **Terraform MCP server** (`hashicorp/terraform-mcp-server:1.4`, Docker, `TRANSPORT_MODE=streamable-http`, port 8080) — the only path to HCP Terraform data in the app. No direct HCP Terraform API calls from the app except the HMAC-verified webhook receiver. The app's MCP client only uses the tools listed in §5 and refuses any call whose workspace is not `RERUN_WORKSPACE`. `ENABLE_TF_OPERATIONS` is never set. |
| Verification | `Verifier` interface. `DockerVerifier` (default): runs `terraform fmt -check`, `terraform validate`, and `terraform plan` (speculative remote plan via the `cloud` block, token from env) in `hashicorp/terraform:1.14` with the patched working copy mounted. `VercelSandboxVerifier` is a stub that throws `NotImplemented` with a pointer to the Dec-2026 follow-up. |
| Source control | GitHub REST via `GITHUB_TOKEN` (fine-grained PAT, `rerun-fixtures` only). Rerun opens PRs; **approval in the dashboard = merge the PR**; the fixtures repo's GitHub Actions then applies; Rerun watches the resulting run and marks the incident resolved on success. Rerun never pushes to `main` directly. |
| Trigger | Polling first (`list_runs` on the one workspace every `RERUN_POLL_SECONDS`, default 30), webhook second (`POST /api/webhook/tfc`, HCP Terraform generic notification, HMAC `X-TFC-Notification-Signature` verified with `TFC_WEBHOOK_SECRET`). Both feed the same `startIncident(runId)`. |
| Storage | Drizzle ORM + libSQL (`@libsql/client`, file `data/rerun.db`). Tables in §6. |
| Telemetry | AI SDK OpenTelemetry (`experimental_telemetry`) → console exporter by default; Langfuse exporter when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set. Every incident stores its own cost (input/output tokens per model, Jev input tokens). |
| Demo mode | `RERUN_MODE=demo`: the app uses `MockTerraformMcpServer` (serves recorded fixtures from `fixtures/scenarios/*/mcp/`), `RecordedDecisionProvider`, a fake GitHub client and a fake verifier. The dashboard is fully usable with zero credentials. CI runs in demo mode. |
| Fixtures repo failures | Seeded with no-cloud providers only: `hashicorp/random`, `hashicorp/null`, `hashicorp/tls`, `hashicorp/http`, `hashicorp/time`, `hashicorp/local`, `terraform_data`. No AWS/GCP/Azure. |
| Scope cuts (not this iteration) | Slack/MCP Apps surface, Vercel deploy, Vercel Sandbox, AI Gateway, Search & Import (drift adoption), multi-workspace, auth on the dashboard, applying runs via MCP. |
| Privacy | The cloud build uses dedicated scoped credentials provided as env vars (see §9). No other real data. Never print secret values in logs, tests, PRs or docs. |

## 2. The incident flow

```
run errored (poll or webhook)
  └─ startIncident(runId)                       workflow "incident"
       1. collect      MCP: get_run_details, get_plan_details/logs, get_plan_json_output (if a plan exists),
                        get_apply_details/logs (if the apply ran), get_state_version (latest), get_workspace_details
       2. triage       DecisionProvider (Jev): failure class, stage, fixability, blast radius  → TriageResult
       3. diagnose     two ToolLoopAgents in parallel, chosen by class (§4): ConfigAgent, RealityAgent → Diagnosis[]
       4. fix          FixAgent: edits the working copy of rerun-fixtures (tools: read_file, write_file, list_files,
                        search_provider_docs via MCP) → Patch (files + rationale per file)
       5. verify       Verifier: fmt, validate, speculative plan → VerifyResult (pass/fail + output)
                        on fail: one retry of fix with the verifier output appended; then give up → needs_human
       6. propose      GitHub: branch rerun/fix-<runId>, commit, PR with the evidence body → PullRequest
                        router (§4): if autoPr → ready-for-review PR; else draft PR + needs_human flag
       7. await        human presses Approve (dashboard) → merge PR → wait for the next run on the workspace
       8. confirm      next run status: applied → resolved; errored → reopened as a new incident linked to this one
```
Every step writes an `IncidentEvent` row (§6) so the dashboard can render a live Trace. Steps are idempotent per `(incidentId, step)`.

## 3. Failure classes

`FailureClass` (closed enum, exact strings):
`config_syntax` · `config_reference` · `missing_input` · `provider_version` · `provider_auth` · `provider_api_error` · `apply_runtime` · `precondition_failed` · `module_source` · `dependency_cycle` · `drift` · `unknown`

Stage: `plan` | `apply` | `init`.

## 4. Decision schema and routing

All decisions go through one Jev request per incident (questions can be mixed in one System One request):

```jsonc
{
  "model": "jev-latest",
  "state": { "runStatus", "stage", "errorExcerpt" /* last 120 lines of the failing log, secrets redacted */,
             "planSummary" /* resource_changes counts + addresses with actions */, "changedFiles" /* from the run's config version if available, else [] */ },
  "questions": {
    "failure_class": { "type": "choice", "instructions": "Which class best describes why this Terraform run failed?",
                        "criteria": { "<each FailureClass>": "<one-line definition>" } },
    "config_fixable": { "type": "noul", "instructions": "<CONFIG_FIXABLE_INSTRUCTIONS>" },
    "blast_radius":   { "type": "score", "instructions": "<BLAST_RADIUS_INSTRUCTIONS>",
                        "criteria": ["Nothing is destroyed or replaced", "Only stateless or trivially recreatable resources", "Stateful or shared resources are replaced", "Data-bearing or network-critical resources are destroyed"] },
    "needs_human":    { "type": "noul", "instructions": "<NEEDS_HUMAN_INSTRUCTIONS>" }
  }
}
```
The `<…_INSTRUCTIONS>` texts live in `src/decisions/questions.ts` (calibrated in W2-J against live Jev; see `docs/RECORDING.md`). That file is the source of truth for the wording.
`TriageResult` = the four answers with probabilities, plus `stage` and the `errorExcerpt` used.

Routing (pure function `route(triage): Route`, unit-tested):
- `autoPr` iff `config_fixable ≥ 0.70` **and** `blast_radius.score ≤ 1.0` **and** `needs_human ≤ 0.40`.
- otherwise `draftPr` (PR is opened as a draft and the incident is flagged `needs_human`).
- `failure_class` ∈ {`provider_auth`, `drift`} → always `draftPr` (these need a credential or an import decision).

Agent selection by class: ConfigAgent always runs; RealityAgent runs when stage = `apply` or class ∈ {`drift`, `apply_runtime`, `provider_api_error`, `unknown`}. Both agents receive the same `IncidentContext` and return a `Diagnosis { agent, rootCause, evidence: EvidenceRef[], suggestedChange, confidence }`.

Jev context limit: 32k tokens per question. `errorExcerpt` is built by `extractErrorExcerpt(log)`: keep lines matching `Error|error|failed|Failed|│` and 20 lines of context after the first `Error:`; cap 120 lines; redact anything matching the token regexes in `src/shared/redact.ts`.

## 5. Terraform MCP tools Rerun uses (allowlist)

Read-only `terraform` toolset: `list_workspaces`, `get_workspace_details`, `list_runs`, `get_run_details`, `get_plan_details`, `get_plan_logs`, `get_plan_json_output`, `get_apply_details`, `get_apply_logs`, `list_state_versions`, `get_state_version`, `get_run_comments`, `whoami`.
Registry toolset: `search_provider_docs`, `get_provider_details`, `get_latest_provider_version`, `get_provider_capabilities`.
Start the server with `--tools <that list>` so nothing else is even registered. The client wrapper (`src/mcp/terraform.ts`) exposes typed functions for exactly these and throws `WorkspaceScopeError` if a call names a workspace other than `RERUN_WORKSPACE`. Argument names come from the live server's `tools/list` — record it once as `fixtures/mcp/tools-list.json` and keep the wrapper in sync with it.

## 6. Data model (Drizzle, libSQL)

- `incidents(id, runId, workspace, status, failureClass, stage, route, prUrl, prNumber, needsHuman, createdAt, resolvedAt, costUsd, parentIncidentId)`
  `status`: `collecting | triaging | diagnosing | fixing | verifying | proposing | awaiting_approval | merged | confirming | resolved | needs_human | failed`
- `incident_events(id, incidentId, seq, at, step, kind, title, payloadJson)` — `kind`: `tool_call | tool_result | decision | agent_step | artifact | status | error`
- `decisions(id, incidentId, provider, requestJson, responseJson, inputTokens, latencyMs, at)`
- `artifacts(id, incidentId, type, name, content)` — `type`: `log | plan_json | diff | verify_output | pr_body`

## 7. Dashboard (Next.js, shadcn + AI Elements)

- `/` — incident list: status pill, failure class, workspace, run id link to HCP Terraform, age, PR link, cost. Live updates via SSE (`/api/incidents/stream`).
- `/incidents/[id]` — the war room, top to bottom:
  1. Header: title (one sentence from the fix rationale), status, route badge, links (run, PR).
  2. **Triage card**: the four Jev answers as probability bars, with the error excerpt in a `Stack Trace` pattern.
  3. **Investigation**: `Trace` of every step; the two agents as `Subagent` panels (tool calls expanded on click).
  4. **Fix**: `Code Block` in diff mode per file with the rationale; **Verification**: `Terminal` pattern with fmt/validate/plan output.
  5. **Approve / Request changes** (`Confirmation` pattern). Approve merges the PR; Request changes posts the text as a PR comment and sets `needs_human`.
  6. Footer: cost (tokens per model, Jev tokens), duration per step.
- Visual bar: dark, dense, calm. No emoji. Monospace for ids/logs. Must look good in a 1280×800 screenshot; the README GIF is recorded from this page in demo mode.

## 8. Evals (`npm run eval`)

Inputs: `fixtures/scenarios/<name>/` for every seeded scenario (§10) with `expected.json` `{ failureClass, stage, route, fixTouches: [paths], mustNotTouch: [paths] }`.
Metrics written to `evals/results.json` and rendered into `README.md` by `npm run eval:readme`:
1. **Triage accuracy** per class (Jev vs `LlmDecisionProvider`), from recorded MCP fixtures.
2. **Calibration**: bucket `config_fixable` and `needs_human` probabilities into 0.1 bins vs. outcomes in `expected.json`.
3. **Robustness** (Almeida's test): perturb the state (rename resources, add a UUID line, reorder plan entries) 5× per scenario; report the verdict flip rate for each provider.
4. **End-to-end** (`--live`): for each scenario, break → wait for the errored run → Rerun → verifier pass? PR opened? `fixTouches` respected? Reported as a table; this mode needs the live credentials and is run by the orchestrator's integration wave, never in GitHub CI.

## 9. Environment variables

| Var | Required | Notes |
|---|---|---|
| `RERUN_MODE` | no | `live` (default) or `demo` |
| `ANTHROPIC_API_KEY` | live | In the Devin cloud it is provided as `RERUN_ANTHROPIC_API_KEY`; `src/config.ts` reads either. |
| `JEV_API_KEY` | live | TypeSafe |
| `TFE_TOKEN`, `TFE_ORG` | live | `TFE_ORG=hashi-org-TF`; passed to the MCP server container, never used by the app directly |
| `RERUN_WORKSPACE` | live | default `rerun-fixtures` |
| `GITHUB_TOKEN`, `RERUN_FIXTURES_REPO` | live | default repo `tayden-b/rerun-fixtures` |
| `TFC_WEBHOOK_SECRET` | no | enables the webhook route |
| `TERRAFORM_MCP_URL` | no | default `http://127.0.0.1:8080/mcp` |
| `RERUN_POLL_SECONDS` | no | default 30; `0` disables polling |
| `RERUN_MODEL_AGENT`, `RERUN_MODEL_FAST` | no | defaults in §1 |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` | no | tracing |
| `DATABASE_URL` | no | default `file:data/rerun.db` |

`docker-compose.yml` runs the MCP server sidecar; `npm run dev` runs the app. `npm run demo` = `RERUN_MODE=demo npm run dev` with the mock server started in-process.

## 10. Seeded scenarios (fixtures repo)

`rerun-fixtures` has a working baseline (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `checks.tf`) using the no-cloud providers, and `scenarios/<name>/` directories each holding `break.patch` (applies to the baseline), `expected.json` (§8 schema) and `README.md` (what a human sees). `scripts/break.sh <name>` resets `main` to the baseline, applies the patch, commits `scenario: <name>` and pushes; `scripts/reset.sh` restores the baseline. The Actions workflow runs `terraform apply -auto-approve` on push to `main` and `terraform plan` on PRs (speculative), using `TF_TOKEN_app_terraform_io` from the repo secret `TFE_TOKEN`.

Required scenarios (name → class, stage):
1. `missing-required-arg` → `config_syntax`, plan
2. `undeclared-reference` → `config_reference`, plan
3. `unset-variable` → `missing_input`, plan
4. `provider-version-conflict` → `provider_version`, init
5. `removed-argument` → `config_syntax`, plan (argument that no longer exists in the pinned provider version)
6. `http-404-postcondition` → `precondition_failed`, plan (data "http" + postcondition on status_code)
7. `check-block-failure` → `precondition_failed`, plan
8. `dependency-cycle` → `dependency_cycle`, plan
9. `module-source-typo` → `module_source`, init
10. `apply-time-exit-1` → `apply_runtime`, apply (`terraform_data` + `local-exec` `exit 1`)
11. `bad-http-url` → `provider_api_error`, plan (data "http" to an unresolvable host)

Each scenario's recorded MCP outputs live in the **app** repo under `fixtures/scenarios/<name>/mcp/<tool>.json` plus `fixtures/scenarios/<name>/jev.json` (recorded Jev answer) so the app's tests and demo mode need no network.

## 11. Shared types (verbatim in `src/shared/types.ts`)

```ts
export type FailureClass = 'config_syntax' | 'config_reference' | 'missing_input' | 'provider_version' | 'provider_auth'
  | 'provider_api_error' | 'apply_runtime' | 'precondition_failed' | 'module_source' | 'dependency_cycle' | 'drift' | 'unknown';
export type Stage = 'init' | 'plan' | 'apply';
export type Route = 'autoPr' | 'draftPr';
export type IncidentStatus = 'collecting' | 'triaging' | 'diagnosing' | 'fixing' | 'verifying' | 'proposing'
  | 'awaiting_approval' | 'merged' | 'confirming' | 'resolved' | 'needs_human' | 'failed';

export interface RunArtifacts {
  run: unknown;                 // get_run_details result (raw)
  workspace: unknown;           // get_workspace_details result (raw)
  planLogs?: string; planJson?: unknown; applyLogs?: string; stateVersion?: unknown;
  stage: Stage; errorExcerpt: string;
}
export interface IncidentContext { incidentId: string; runId: string; workspace: string; artifacts: RunArtifacts; triage?: TriageResult; repo: { owner: string; name: string; baseBranch: string; headSha: string }; }

export interface ChoiceAnswer { choice: string; confidence: number; probabilities: Record<string, number> }
export interface NoulAnswer { noul: number }
export interface ScoreAnswer { score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string> }
export interface TriageResult {
  failureClass: ChoiceAnswer & { choice: FailureClass };
  configFixable: NoulAnswer; blastRadius: ScoreAnswer; needsHuman: NoulAnswer;
  stage: Stage; errorExcerpt: string; provider: 'jev' | 'llm' | 'recorded'; inputTokens: number; latencyMs: number;
}
export interface DecisionQuestion { type: 'choice' | 'noul' | 'score'; instructions: string; criteria?: Record<string, string> | string[] }
export interface DecisionProvider {
  readonly name: 'jev' | 'llm' | 'recorded';
  decide(state: unknown, questions: Record<string, DecisionQuestion>): Promise<{ answers: Record<string, ChoiceAnswer | NoulAnswer | ScoreAnswer>; inputTokens: number; latencyMs: number }>;
}

export interface EvidenceRef { kind: 'log' | 'plan' | 'state' | 'file' | 'docs'; ref: string; excerpt: string }
export interface Diagnosis { agent: 'config' | 'reality'; rootCause: string; evidence: EvidenceRef[]; suggestedChange: string; confidence: number; steps: number }
export interface PatchFile { path: string; before: string | null; after: string; rationale: string }
export interface Patch { files: PatchFile[]; title: string; summary: string }
export interface VerifyResult { ok: boolean; fmt: StepOutput; validate: StepOutput; plan: StepOutput; summary: string }
export interface StepOutput { ok: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }
export interface PullRequest { number: number; url: string; branch: string; draft: boolean }

export interface Verifier { readonly name: 'docker' | 'vercel-sandbox' | 'fake'; verify(workdir: string): Promise<VerifyResult> }
export interface IncidentEvent { incidentId: string; seq: number; at: string; step: string; kind: 'tool_call' | 'tool_result' | 'decision' | 'agent_step' | 'artifact' | 'status' | 'error'; title: string; payload: unknown }
```
