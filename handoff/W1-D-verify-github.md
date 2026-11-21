# Task: Rerun — Docker verifier (fmt/validate/speculative plan), GitHub client (repo tree, branch, PR, merge, comment), run watcher

Repo: https://github.com/tayden-b/rerun — branch `work/w1d-verify-github` off `dev`, PR into `dev`.
Model: judgment. Read `AGENTS.md`, `handoff/SPEC.md` (§1 Verification/Source control, §2 steps 5–8, §9, §11) and the merged W0-A scaffold first. Git identity per `AGENTS.md`.
You MAY read `GITHUB_TOKEN` and `TFE_TOKEN` from your env for live tests only (GitHub: against `tayden-b/rerun-fixtures` on a throwaway branch you delete afterwards; Terraform: a speculative plan). Never print or commit values. Docker is required for the verifier tests; if unavailable, report and keep unit tests runnable.

## Owned paths
`src/verify/**`, `src/github/**`, `src/watch/**`, `test/verify/**`, `test/github/**`.

## Required behaviour
1. **Verifier interface** per SPEC §11. `src/verify/docker.ts` — `DockerVerifier`: given a workdir (the patched fixtures config), runs in `hashicorp/terraform:1.14` (pin the exact tag that exists) with the dir mounted read-write at `/work`, env `TF_TOKEN_app_terraform_io` from `TFE_TOKEN`, `TF_IN_AUTOMATION=1`, `TF_INPUT=0`: (a) `terraform fmt -check -recursive`, (b) `terraform init -input=false` + `terraform validate`, (c) `terraform plan -input=false -no-color` — because the config has a `cloud {}` block this is a **speculative remote plan** on the real workspace (it does not lock or change state). Each as a `StepOutput`; stop at the first failure; `ok` iff all three pass; `summary` = the plan's "Plan: X to add, Y to change, Z to destroy" line or the first error line. Timeout 10 minutes, kill the container on timeout. Use `execa` or `node:child_process`; no Docker SDK. Redact outputs.
   `src/verify/fake.ts` — `FakeVerifier` for demo mode: returns a canned passing `VerifyResult` from `fixtures/scenarios/<name>/verify.json` if present, else a generic pass. `src/verify/vercel-sandbox.ts` — stub throwing `NotImplementedError('Vercel Sandbox verifier lands after the Dec 2026 fair-use window; see docs/HANDOFF.md')`. `createVerifier(config)` factory.
2. **GitHub client** `src/github/client.ts` using `@octokit/rest` (pinned) with `GITHUB_TOKEN`, repo from `RERUN_FIXTURES_REPO`: `getRepoSnapshot(ref) → { headSha, files: Record<path, content> }` (git trees API, recursive; skip binaries and `scenarios/**`, `baseline/**`, `.github/**` from the agent's view but keep them in the commit), `createBranch(name, fromSha)`, `commitFiles(branch, files: PatchFile[], message)` (blobs → tree → commit → ref update), `openPullRequest({ branch, base: 'main', title, body, draft }) → PullRequest`, `mergePullRequest(number, { method: 'squash' })`, `commentOnPullRequest(number, body)`, `closePullRequest(number)`, `deleteBranch(name)`. `src/github/fake.ts` — in-memory fake with the same interface for demo/CI. `src/github/prBody.ts` — `renderPrBody({ triage, diagnoses, patch, verify, runUrl, incidentUrl })`: a crisp Markdown template (what failed, why, what changed and why, verification output in a collapsed block, Jev probabilities table, link back to the Rerun incident). `createGitHub(config)` factory.
3. **Run watcher** `src/watch/runs.ts`: `watchForNextRun(mcp, { afterRunId, timeoutMs, pollMs }) → { runId, status }` using the MCP client's `listRuns` (code against the SPEC §11-era interface `listRuns({status?, pageSize?})`; W1-A implements it — use a fake in tests) and `pollErroredRuns(mcp, { since, seen: Set<string> }) → runIds` for the poller. Both pure/polling helpers, no DB.

## Tests
- Verifier unit: a fake `docker` executable on PATH (shell script in `test/verify/bin/`) returning scripted exit codes/outputs → `VerifyResult` mapping, stop-at-first-failure, summary extraction, timeout kill.
- Verifier live (skipped unless Docker **and** `TFE_TOKEN`): clone `tayden-b/rerun-fixtures@main` into a temp dir → `DockerVerifier.verify` → `ok: true` and summary contains `Plan:`.
- GitHub unit against the fake; `renderPrBody` snapshot.
- GitHub live (skipped unless `GITHUB_TOKEN`): snapshot `main` → create branch `rerun/test-<ts>` → commit a one-line README change → open **draft** PR → comment → close PR → delete branch. Leaves nothing behind.
- Watcher: fake `listRuns` sequences → resolves on the first run newer than `afterRunId` in a terminal state; times out cleanly.

## Guardrails
- Never merge or push to `main` in tests. Never run `terraform apply`. No suppressions, no sub-agents, pinned deps.

## Done
- CI green. PR title `W1-D: Docker verifier, GitHub client, run watcher`. **Do not merge.** Report: PR URL, CI, live verifier output summary, the exact image tag, the throwaway PR number you opened and closed.


## Orchestrator notes (added after cross-brief review — these override anything above)
- **Credentials in your env**: the scoped keys this brief allows you to use are org secrets that may not be in your shell env by default. Bind them per command via exec `env`, e.g. `{"JEV_API_KEY": "secret:org:JEV_API_KEY"}`, `{"RERUN_ANTHROPIC_API_KEY": "secret:org:RERUN_ANTHROPIC_API_KEY"}`, `{"TFE_TOKEN": "secret:org:TFE_TOKEN", "TFE_ORG": "secret:org:TFE_ORG"}`, `{"GITHUB_TOKEN": "secret:org:GITHUB_TOKEN"}`. Only the ones your brief names. Never print/echo/commit values. GitHub CI never has them.
- **Workspace scope**: touch only the HCP Terraform workspace `rerun-fixtures` in `hashi-org-TF`. Never set `ENABLE_TF_OPERATIONS`.
- **Shared files** (`package.json`, `package-lock.json`, `.github/workflows/ci.yml`): six Wave 1 workers run in parallel. Only add your deps/scripts to `package.json` (pinned, `save-exact`); do not reorder or reformat it. Do not edit `.github/workflows/ci.yml` unless this brief says so. Before your final push, `git merge origin/dev`; on lockfile conflicts take `dev`'s lockfile and re-run `npm install` to regenerate, never hand-edit it.
- **AI SDK 6 / MCP API names**: where a brief names an API (`generateObject`, `experimental_createMCPClient`, `MockLanguageModelV3`), use the current non-deprecated equivalent in the pinned version (e.g. `generateText` with `output: Output.object(...)`, `createMCPClient` from `@ai-sdk/mcp`) and note the choice in your PR.
- Do not change `src/shared/types.ts`. If a SPEC §11 type genuinely blocks you, explain in the PR and update `handoff/SPEC.md` §11 in the same PR.
- Work fast: compute is free; the orchestrator is waiting on your PR to start the next wave.
- `listRuns` result shape: W1-A is building it in parallel from the real server; define the minimal shape you need (`{ id, status, createdAt }[]`) as a local type adapter in `src/watch/` so Wave 2 can map W1-A's output to it.
