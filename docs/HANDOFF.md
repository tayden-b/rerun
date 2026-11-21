# Handoff

How to run Rerun live on your Mac, fix the usual failures, and show it to a customer. Every command is meant to be pasted as is. Step timings are filled in by the live gate (G2); until then they read `TBD (G2)`.

Contents:

1. [Checklist (under 20 minutes)](#checklist-under-20-minutes)
2. [Troubleshooting](#troubleshooting)
3. [Known limitations](#known-limitations)
4. [Live eval](#live-eval)
5. [When the Vercel block lifts](#when-the-vercel-block-lifts)
6. [Show it in 5 minutes](#show-it-in-5-minutes)

## Checklist (under 20 minutes)

Before you start you need Docker Desktop running, Node 24 (`node -v`), `git` with push access to `tayden-b/rerun-fixtures`, and your env file at `~/.config/rerun/env`. The HCP Terraform workspace `rerun-fixtures` should be on a successful `applied` run (run `scripts/reset.sh` from step 9 first if it is not).

Use two terminal tabs: **app** (the `rerun` clone) and **fixtures** (the `rerun-fixtures` clone).

### 1. Clone both repos

Timing: `TBD (G2)`

```bash
mkdir -p ~/code && cd ~/code
git clone https://github.com/tayden-b/rerun
git clone https://github.com/tayden-b/rerun-fixtures
```

### 2. Copy your env file

Timing: `TBD (G2)`

**app** tab:

```bash
cd ~/code/rerun
cp ~/.config/rerun/env .env
git check-ignore .env   # prints ".env": the file is ignored and cannot be committed
```

`.env` is read by both `docker compose` (for `TFE_TOKEN`) and `npm run dev` (everything else). It must contain:

| Variable                  | What it is for                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TFE_TOKEN`               | HCP Terraform user or team token with read access to the `rerun-fixtures` workspace. Read by the `terraform-mcp` container and by the Docker verifier for the speculative plan. Nothing else.    |
| `TFE_ORG`                 | HCP Terraform organization that owns the workspace. Live mode refuses to start incidents without it.                                                                                             |
| `GITHUB_TOKEN`            | Fine-grained GitHub token for `tayden-b/rerun-fixtures` only: opens the fix branch and PR, comments, marks drafts ready and merges on Approve. Scopes in [Troubleshooting](#github-token-scope). |
| `JEV_API_KEY`             | TypeSafe System One (Jev) key for triage. Without it Rerun falls back to the Claude decision provider.                                                                                           |
| `RERUN_ANTHROPIC_API_KEY` | Anthropic key for the Config, Reality and Fix agents. Wins over `ANTHROPIC_API_KEY` when both are set.                                                                                           |

Optional, with the defaults the checklist assumes (leave them out):

| Variable              | Default                     | What it is for                                                              |
| --------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `RERUN_MODE`          | `live`                      | `demo` runs on recorded fixtures with no credentials.                       |
| `RERUN_WORKSPACE`     | `rerun-fixtures`            | The only workspace Rerun reads; the MCP client refuses any other.           |
| `RERUN_FIXTURES_REPO` | `tayden-b/rerun-fixtures`   | Repository the fix PRs target.                                              |
| `RERUN_POLL_SECONDS`  | `30`                        | How often the poller calls `list_runs`. `0` turns polling off.              |
| `TERRAFORM_MCP_URL`   | `http://127.0.0.1:8080/mcp` | Terraform MCP server endpoint.                                              |
| `TFC_WEBHOOK_SECRET`  | unset                       | Enables `POST /api/webhook/tfc` (HMAC-verified HCP Terraform notification). |
| `DATABASE_URL`        | `file:data/rerun.db`        | libSQL database.                                                            |

The full list is in `.env.example`.

### 3. Start the Terraform MCP server

Timing: `TBD (G2)`

```bash
docker compose up -d
docker compose ps    # terraform-mcp is "Up", port 127.0.0.1:8080->8080/tcp
```

Check that the server registered only the allowlisted tools. The startup log names them:

```bash
docker compose logs terraform-mcp | grep "Enabled individual tools"
```

Then ask the server itself for its tool list over MCP (`jq` ships with macOS 15; otherwise `brew install jq`):

```bash
MCP=http://127.0.0.1:8080/mcp
SID=$(curl -s -D - -o /dev/null "$MCP" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}' \
  | awk -F': ' 'tolower($1)=="mcp-session-id"{print $2}' | tr -d '\r')
curl -s "$MCP" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | sed -n 's/^data: //p; /^{/p' | jq -r '.result.tools[].name' | sort
```

Expect exactly these 17 names, the same list as `src/mcp/allowlist.ts` and `/about`:

```text
get_apply_details
get_apply_logs
get_latest_provider_version
get_plan_details
get_plan_json_output
get_plan_logs
get_provider_capabilities
get_provider_details
get_run_comments
get_run_details
get_state_version
get_workspace_details
list_runs
list_state_versions
list_workspaces
search_provider_docs
whoami
```

Only the four registry tools (`get_latest_provider_version`, `get_provider_capabilities`, `get_provider_details`, `search_provider_docs`) means the container started without `TFE_TOKEN`; see [MCP 401](#mcp-401-or-only-four-tools). Any tool not in the list (for example `create_run` or `apply_run`) means the server was started some other way than this `docker-compose.yml`: run `docker compose down && docker compose up -d`.

### 4. Install, migrate, start the app

Timing: `TBD (G2)`

```bash
npm ci && npm run db:migrate && npm run dev
```

Ready when the terminal prints `Ready in …`. Leave it running in this tab; the poller logs here as `[poller] …`. Open `http://localhost:3000`: the Incidents page is empty and the top bar has no `demo` badge.

### 5. Break a scenario

Timing: `TBD (G2)`

**fixtures** tab. Wait until step 4 is ready first: the poller only picks up runs created after the app started.

```bash
cd ~/code/rerun-fixtures
scripts/break.sh apply-time-exit-1
```

It restores the baseline, applies `scenarios/apply-time-exit-1/break.patch`, commits `scenario: apply-time-exit-1`, pushes `main` and prints the GitHub Actions run URL (the URL needs the `gh` CLI; without it you get the Actions page). The push uses your own git credentials, not `GITHUB_TOKEN`.

### 6. Watch `http://localhost:3000`

What appears, in order:

| What you see                                                                                                                                         | Roughly when                                           | Timing     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| The Actions run applies; the HCP Terraform run plans a replace of `terraform_data.announce` and errors in apply with `local-exec provisioner error`. | 1–3 min after the push                                 | `TBD (G2)` |
| A row appears on Incidents, status Collecting; the app log prints `[poller] started incident for run-…`.                                             | Within `RERUN_POLL_SECONDS` (30 s) of the run erroring | `TBD (G2)` |
| Open the row. Triage fills in: Apply runtime at apply, Fixable in config ~92 %, Blast radius ~1.0 / 3, Needs a human ~29 %; route Auto PR.           | Seconds after the incident appears                     | `TBD (G2)` |
| Investigation: Config agent and Reality agent run in parallel, each with its tool calls and a diagnosis.                                             | About a minute                                         | `TBD (G2)` |
| Fix: a one-line diff to `main.tf` (`announce_command` loses `&& exit 1`). Verification: `fmt`, `validate`, speculative `plan` in Docker.             | The plan takes about 30 s                              | `TBD (G2)` |
| Status Awaiting approval; a ready-for-review PR `rerun/fix-<runId>` exists on `rerun-fixtures`; the bottom bar shows **Approve and merge**.          | Total from push: `TBD (G2)`                            | `TBD (G2)` |

If the route is Draft PR instead (it can happen: `blast_radius` sits at the 1.0 limit for this scenario, see [Known limitations](#known-limitations)), the incident shows Needs a human and the PR is a draft. Approve still works; it marks the draft ready and merges.

### 7. Approve

Timing: `TBD (G2)`

In the incident, click **Approve and merge**. A toast says `Approved. Merging the PR.`. Rerun squash-merges the PR (status Merged); the merge triggers the fixtures repo's Actions apply.

### 8. Confirm `resolved`

Timing: `TBD (G2)`

Rerun polls `list_runs` every 15 s for the first run created after the merge. When that run is `applied`, the status pill turns **Resolved** and "Confirmed next run" gets a check. Check from the **app** tab too:

```bash
curl -s http://localhost:3000/api/incidents | jq -r '.incidents[0] | "\(.status) \(.prUrl)"'
```

Expect `resolved https://github.com/tayden-b/rerun-fixtures/pull/<n>`. If the next run errors instead, the incident goes to Needs a human and a linked child incident starts. If no run appears within 45 minutes, it goes to Needs a human.

### 9. Reset

Timing: `TBD (G2)`

**fixtures** tab:

```bash
git pull --ff-only
scripts/reset.sh
```

`reset.sh` restores `baseline/`, commits `reset: baseline` and pushes, which queues one more apply. It prints `Already at baseline; nothing to push.` when the merged fix already matches the baseline. Wait for the workspace to show `applied` before the next break. Stop the app with Ctrl-C and the MCP server with `docker compose down` in the **app** tab.

### Live quickstart timings

Filled in by G2.

| Interval                                  | Time       |
| ----------------------------------------- | ---------- |
| Clone → `npm run dev` ready               | `TBD (G2)` |
| `break.sh` → HCP Terraform run `errored`  | `TBD (G2)` |
| Run `errored` → incident created          | `TBD (G2)` |
| Incident created → Awaiting approval      | `TBD (G2)` |
| Approve → PR merged                       | `TBD (G2)` |
| PR merged → next run `applied` → Resolved | `TBD (G2)` |

## Troubleshooting

### Docker not running

`docker compose up -d` prints `Cannot connect to the Docker daemon`, or a fix fails at Verification with `docker: command not found` / `Cannot connect`. Start Docker Desktop, wait for "Engine running", then rerun `docker compose up -d`. The verifier needs Docker too: the first verification pulls `hashicorp/terraform:1.14.9`, so pre-pull it with `docker pull hashicorp/terraform:1.14.9`.

### MCP 401 (or only four tools)

The incident fails at Collected run data with `unauthorized` (for example `failed to read account details: unauthorized`), or `tools/list` in step 3 shows only the four registry tools. The container has no `TFE_TOKEN`, or the token is wrong or expired. `docker compose` reads `TFE_TOKEN` from `.env` in the `rerun` directory when the container is created, so fix `.env` and recreate it:

```bash
docker compose up -d --force-recreate
```

Then repeat the check in step 3.

### The poller does not see the run

No incident appears after the HCP Terraform run errored. Check in order:

- The app log shows `[poller] …` errors: the MCP server is down or unreachable (`docker compose ps`), or `TERRAFORM_MCP_URL` points elsewhere.
- The run was created before `npm run dev` started. The poller ignores runs older than the process. Fix: run `scripts/reset.sh`, then break again with the app running.
- The run is not `errored` yet (still applying, or queued behind another run). Wait; the poller retries every 30 s.
- `RERUN_POLL_SECONDS=0` or `RERUN_WORKSPACE` is set to another workspace in `.env`. Remove them.
- Restarting `npm run dev` forgets which runs it already saw, but the database keeps one incident per run, so nothing is duplicated.

### Verifier token

Verification fails at `terraform init` or `plan` with `Required token could not be found` or `unauthorized`. The Docker verifier forwards `TFE_TOKEN` from the app's environment into the container as `TF_TOKEN_app_terraform_io`. Make sure `TFE_TOKEN` is in `.env` (not only exported in another shell), then restart `npm run dev`. The token needs permission to queue speculative plans on `rerun-fixtures` (workspace "plan" access).

### GitHub token scope

Propose or Approve fails with `Resource not accessible by personal access token` or `Not Found`. `GITHUB_TOKEN` must be a fine-grained token with repository access to `tayden-b/rerun-fixtures` and these permissions:

- Contents: Read and write (branch, commit, merge).
- Pull requests: Read and write (open, comment, mark ready for review).
- Metadata: Read (granted automatically).

Update `.env` and restart `npm run dev`.

### The org `ANTHROPIC_API_KEY` overrides `RERUN_ANTHROPIC_API_KEY`

Agents fail with an Anthropic `invalid x-api-key` / 401, or usage lands on another project's key. Values already exported in your shell beat `.env` (Next does not overwrite existing environment variables), so a shell-wide `ANTHROPIC_API_KEY` from another project is used whenever `RERUN_ANTHROPIC_API_KEY` is missing from both. Put `RERUN_ANTHROPIC_API_KEY` in `.env` (it wins over `ANTHROPIC_API_KEY` when both are set), and run the app from a shell without the other key:

```bash
unset ANTHROPIC_API_KEY RERUN_ANTHROPIC_API_KEY
npm run dev
```

## Known limitations

- **One workspace, one repository.** The scope guard allows only `RERUN_WORKSPACE`; fix PRs go to `RERUN_FIXTURES_REPO`.
- **Polling interval.** New errored runs are found up to `RERUN_POLL_SECONDS` (30 s) late, and confirmation polls every 15 s. The webhook removes the first delay but needs a URL HCP Terraform can reach, which a laptop does not have.
- **Demo GitHub is in memory.** In demo mode the PR is created by a fake GitHub client and lives only in the running process; the war room shows it as plain text (`#1 · demo`), not a link. Restarting the demo forgets the PR.
- **No unique index on `incidents.run_id` yet** (not on `dev` as of this writing; assigned to W2-L). Within one process `startIncident` dedupes, but two processes on the same database (for example `npm run dev` plus a live eval) can each create an incident for the same run. Run one process per database.
- **Live eval is incomplete: 9/11.** The `RERUN_ANTHROPIC_API_KEY` account is out of credits (`credit balance is too low`), so `bad-http-url`, `apply-time-exit-1` and approve → resolved have not run live yet. They need a funded key; the org `ANTHROPIC_API_KEY` is deliberately not used. Until then the live checklist (steps 5–9) is unproven end to end.
- **`blast_radius` is at the edge for `apply-time-exit-1`.** Jev answers 1.00 against the `≤ 1.0` autoPr limit (the LLM provider answers 1.02). Any extra probability on a higher level routes it to a draft PR with Needs a human. Approve works either way.
- **A speculative plan cannot prove an apply-time fix.** For `apply_runtime` the verifier proves the plan succeeds; only the post-merge apply confirms the fix.
- **No dashboard authentication.** Anyone who can reach `localhost:3000` can approve a merge. Keep it on localhost.
- **Vercel block.** Vercel deploy and Vercel Sandbox are out of scope until the December 2026 fair-use window (SPEC §1 scope cuts). Until then the app runs locally with the Docker verifier, polling, the Local World in `.workflow-data/` and a SQLite file, and `src/verify/vercel-sandbox.ts` throws `NotImplementedError`.

## Live eval

<!-- live-eval:start -->
<!-- live-eval:end -->

## When the Vercel block lifts

Three changes: the Sandbox verifier, a deploy, and the webhook instead of polling. The first and the deploy need code changes, listed here so they can be briefed as one task.

### 1. Sandbox verifier

1. Add the SDK: `npm i @vercel/sandbox@<pinned version>` (exact pin, commit `package-lock.json`).
2. Implement `VercelSandboxVerifier.verify(workdir)` in `src/verify/vercel-sandbox.ts` with the same contract as `DockerVerifier` (`src/verify/docker.ts`): copy the patched working copy into a sandbox, install Terraform 1.14.9, run `terraform fmt -check -recursive`, `terraform init` + `validate`, then the speculative `plan`, stop at the first failure, and pass every output through `redact()`. Give the sandbox `TF_TOKEN_app_terraform_io` from `TFE_TOKEN`, as the Docker verifier does.
3. Select it. Today `createVerifier` in `src/verify/index.ts` picks `fake` in demo and `docker` in live, and `src/incident/services.ts` calls it without a `kind`. Add a `RERUN_VERIFIER` (`docker` | `vercel-sandbox`) setting to `src/config.ts` and `.env.example` and pass it through as `kind` (a `src/config.ts` change goes through the orchestrator).
4. Auth for the sandbox: on Vercel the function's OIDC token (`VERCEL_OIDC_TOKEN`) is used automatically. Locally, run `vercel link` and `vercel env pull` to get `VERCEL_OIDC_TOKEN`, or set `VERCEL_TOKEN`, `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`.
5. Add a `*.live.test.ts` that runs one verification in a real sandbox, and keep `docker` as the default until it passes.

### 2. Deploy

1. Database: a SQLite file does not survive on Vercel. Create a hosted libSQL database (for example Turso) and set `DATABASE_URL=libsql://<db-host>?authToken=<token>` (`@libsql/client` reads `authToken` from the URL). Run `npm run db:migrate` against it once.
2. Terraform MCP server: Vercel functions cannot reach `127.0.0.1:8080`. Run the same container (`hashicorp/terraform-mcp-server:1.4`, the `streamable-http` subcommand and the `--tools=` list from `docker-compose.yml`, never `TRANSPORT_MODE` or `ENABLE_TF_OPERATIONS`) on a host with TLS that only Rerun can reach, and set `TERRAFORM_MCP_URL=https://<mcp-host>/mcp`. `TFE_TOKEN` lives on that host.
3. Workflow: on Vercel the Workflow SDK uses the Vercel World automatically; `.workflow-data/` is local only.
4. Project env vars (Production): `RERUN_MODE=live`, `TFE_ORG`, `TFE_TOKEN` (for the verifier), `GITHUB_TOKEN`, `JEV_API_KEY`, `RERUN_ANTHROPIC_API_KEY`, `DATABASE_URL`, `TERRAFORM_MCP_URL`, `TFC_WEBHOOK_SECRET`, `RERUN_POLL_SECONDS=0`, `RERUN_VERIFIER=vercel-sandbox`.
5. Deploy: `vercel link`, then `vercel --prod`.
6. Code changes needed first: the PR body links to `http://localhost:<PORT>/incidents/<id>` (`incidentUrl` in `src/incident/services.ts`), so add a public base URL setting; and add dashboard authentication before the URL is shared, since Approve merges.

### 3. Webhook instead of polling

1. Generate a secret: `openssl rand -hex 32`, and set it as `TFC_WEBHOOK_SECRET` in the Vercel project. The route `POST /api/webhook/tfc` returns 404 until it is set.
2. In HCP Terraform: workspace `rerun-fixtures` → Settings → Notifications → Create a notification → **Webhook** (generic). URL `https://<app-host>/api/webhook/tfc`, Token = the same secret, Triggers: **Errored**. HCP Terraform signs each body with HMAC-SHA512 in `X-TFC-Notification-Signature`; the route rejects a bad signature with 401.
3. Click "Send a test" in HCP Terraform: the route answers 202 with `{"accepted":false}` (a test is not an errored run).
4. Set `RERUN_POLL_SECONDS=0` so the poller stays off; the webhook and the poller both call `startIncident(runId)`, so either one works on its own.
5. Break a scenario and check that the incident appears within seconds of the run erroring.

## Show it in 5 minutes

A customer demo of the live flow. Times are minutes from the start of the demo.

### Pre-flight (T−10 min)

- Checklist steps 2–4 done: `docker compose ps` shows `terraform-mcp` Up, `npm run dev` is running, the Incidents page is empty or shows only resolved incidents.
- The workspace's latest run is `applied` (reset if not).
- Browser tabs, in this order: `http://localhost:3000/about`, `http://localhost:3000`, the `rerun-fixtures` Pull requests page on GitHub, the `rerun-fixtures` workspace Runs page in HCP Terraform.
- **fixtures** terminal in `~/code/rerun-fixtures` on a clean `main` with `scripts/break.sh apply-time-exit-1` typed but not run.
- **app** terminal visible with the `npm run dev` log.
- Rule: if G2 measures push → Awaiting approval above 2 minutes, run the break at T−3 min instead of at 1:00, and talk through `/about` while it runs.

### 0:00–1:00 — `/about`

Open `/about`. Point at the architecture row, then the MCP tools list.

Talk track: "Rerun watches one HCP Terraform workspace. Everything it knows about Terraform comes through the Terraform MCP server, the same server your engineers' coding agents use, started with an allowlist of these 17 read-only tools and scoped to one workspace, so it cannot queue, apply or discard a run. When a run fails, it triages the failure, writes the smallest fix, proves it with a speculative plan and opens a pull request; a person approves the merge."

### 1:00–1:30 — Break a scenario live

In the **fixtures** terminal, press Enter on `scripts/break.sh apply-time-exit-1`. Say: "This pushes a change whose `local-exec` provisioner exits 1, so the plan passes and the apply fails, the kind of failure a plan review misses." Switch to the HCP Terraform tab and show the run applying.

### 1:30–2:30 — The incident appears

Switch to `http://localhost:3000`. The run errors in apply, and within 30 s an incident row appears (Collecting). Open it.

Go/no-go: if no incident has appeared by 2:30, go to [Fallback](#fallback-if-live-is-slow).

### 2:30–3:30 — Walk the war room

Top to bottom, as it fills in:

- **Triage** (right): one Jev request answers four questions; read the bars: Apply runtime at apply, Fixable in config about 90 %, Blast radius about 1 of 3, Needs a human about 30 %, so the route is an auto PR.
- **Investigation**: the Config agent and the Reality agent run in parallel. Expand one tool call to show it was an MCP call or a file search, and read each diagnosis.
- **Fix**: the one-line diff in `main.tf` and the reason for it.
- **Verification**: the verifier terminal: `terraform fmt -check`, `validate`, then a real speculative plan in HCP Terraform ending in its `Plan:` summary line

### 3:30–4:00 — Approve

When the status is Awaiting approval, click the PR link in the header to show the evidence in the PR body, come back, and click **Approve and merge**. Say: "Approval is the merge. Rerun never pushes to main; the repository's own pipeline applies the change."

### 4:00–5:00 — Merged PR and resolved incident

Switch to the GitHub Pull requests tab: the PR is merged. Switch to HCP Terraform: the new run applies. Back on the incident, the status turns **Resolved** when that run is `applied`, and "Confirmed next run" gets its check. Close on the Incidents list.

After the call, run checklist step 9.

### Fallback if live is slow

If no incident appeared by 2:30, switch to demo mode. It runs the same workflow on the recorded `apply-time-exit-1` run and reaches Awaiting approval about 12 s after start. In the **app** terminal:

```bash
# Ctrl-C to stop npm run dev, then:
npm run demo -- --fresh
```

`terraform-mcp` can keep running: the demo's mock MCP server listens on port 8081. Reload `http://localhost:3000` (the top bar now shows `demo`), open the incident, and continue at 2:30. Approve resolves in about 4 s. In demo mode the PR is plain text (`#1 · demo`), so skip the GitHub tab at 4:00. After the demo, `scripts/reset.sh` in the **fixtures** tab undoes the live break.
