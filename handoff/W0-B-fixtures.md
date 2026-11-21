# Task: Rerun — fixtures repo with baseline Terraform config, GitHub Actions apply, 11 seeded failure scenarios, HCP Terraform workspace

Repo: https://github.com/tayden-b/rerun-fixtures — empty. Push an initial commit to `main`, then work on `work/w0b-fixtures` and open a PR into `main`.
Model: judgment. Git identity: `git config user.name "Tayden Barretto" && git config user.email "taydenpbarretto@gmail.com"`.
You MAY read `TFE_TOKEN` and `TFE_ORG` from your environment (they are scoped project credentials). Never print them, never commit them, never pass them to anything but the HCP Terraform API / Terraform CLI. If they are absent, do everything except the workspace creation and say so.

## Context
This repo is the Terraform configuration that the app `tayden-b/rerun` watches and fixes. The HCP Terraform workspace `rerun-fixtures` in organization `${TFE_ORG}` (= `hashi-org-TF`) applies it via GitHub Actions (CLI-driven remote runs; no VCS connection). The org contains other workspaces: **touch only `rerun-fixtures`**. The repo secret `TFE_TOKEN` and variable `TFE_ORG` already exist in GitHub.

## Required behaviour
1. **Baseline config** (`main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, `checks.tf`) that plans and applies cleanly on HCP Terraform remote runners using only `hashicorp/random`, `hashicorp/null`, `hashicorp/tls`, `hashicorp/http`, `hashicorp/time`, `hashicorp/local`, `terraform_data`. It should look like a plausible small platform module: a few `random_pet`/`random_id` names, a `tls_private_key` + self-signed cert, a `time_rotating`, a `data "http"` against `https://httpbin.org/status/200` with a `postcondition` on `status_code`, a `check` block, a local module `modules/naming` used twice, and `terraform_data` with a `local-exec` provisioner that echoes. `versions.tf` pins Terraform `~> 1.14` and each provider to an exact version, and has `cloud { organization = "hashi-org-TF"  workspaces { name = "rerun-fixtures" } }`.
2. **Actions**: `.github/workflows/terraform.yml`: on push to `main` → `hashicorp/setup-terraform` (1.14.x, `cli_config_credentials_token: ${{ secrets.TFE_TOKEN }}`), `terraform init -input=false`, `terraform apply -auto-approve -input=false`. On `pull_request` → init + `terraform plan -input=false` (speculative). Both post nothing else. The apply job must not be cancelled by a newer push (`concurrency` group with `cancel-in-progress: false`).
3. **Workspace**: `scripts/ensure-workspace.sh` (bash + curl + jq, idempotent): creates `rerun-fixtures` in `$TFE_ORG` if missing with `execution-mode: remote`, `auto-apply: true`, `terraform-version: 1.14.x` (latest 1.14 the API accepts), `description: "Rerun demo workspace — seeded failures; fixed by tayden-b/rerun"`. Run it. Then verify the baseline: push to `main` and confirm the Actions apply run finishes `applied` in HCP Terraform (poll `GET /api/v2/workspaces/:id/runs` with the token; never print the token).
4. **Scenarios**: `scenarios/<name>/{break.patch, expected.json, README.md}` for exactly these 11 (name → `failureClass`, `stage`):
   `missing-required-arg`→`config_syntax`,plan · `undeclared-reference`→`config_reference`,plan · `unset-variable`→`missing_input`,plan · `provider-version-conflict`→`provider_version`,init · `removed-argument`→`config_syntax`,plan · `http-404-postcondition`→`precondition_failed`,plan · `check-block-failure`→`precondition_failed`,plan · `dependency-cycle`→`dependency_cycle`,plan · `module-source-typo`→`module_source`,init · `apply-time-exit-1`→`apply_runtime`,apply (`local-exec` `exit 1`) · `bad-http-url`→`provider_api_error`,plan (unresolvable host).
   `expected.json` schema: `{ "name", "failureClass", "stage", "route": "autoPr"|"draftPr", "fixTouches": ["main.tf"], "mustNotTouch": ["versions.tf"], "humanSummary": "..." }` — `route` is `autoPr` for all except `provider-version-conflict` and `module-source-typo` (ambiguous intent → `draftPr`). Each `break.patch` applies cleanly to the baseline with `git apply` and changes the minimum needed. `README.md` says what a human sees in the run log.
5. **Scripts**: `scripts/break.sh <name>` — asserts clean tree on `main`, `git apply scenarios/<name>/break.patch`, commits `scenario: <name>`, pushes `main`, prints the Actions run URL. `scripts/reset.sh` — restores the baseline files from `baseline/` (keep a pristine copy of the five baseline files there, used by both scripts; the root files are the live config), commits `reset: baseline`, pushes. `scripts/verify-scenarios.sh` — for each scenario: apply patch in a temp dir, `terraform init -backend=false && terraform validate` and assert the ones that are supposed to fail at validate do fail, and the others validate (they fail later at plan/apply); restores tree. Document all in `README.md`.
6. **Prove every scenario fails for the expected reason**: run `scripts/break.sh <name>` for each of the 11 in sequence (wait for each run to reach a terminal state; expected `errored` for all; use `scripts/reset.sh` between them), and record in `scenarios/RESULTS.md` the run id, final status, stage at which it failed and the first error line (redacted). Leave the workspace on the baseline (last action = `reset.sh`, run `applied`).

## Tests
- `scripts/verify-scenarios.sh` passes locally (needs only the Terraform CLI).
- `scenarios/RESULTS.md` shows 11 `errored` runs with the expected stage each, plus the final baseline `applied` run.
- `terraform fmt -check` clean on baseline and after each patch.

## Guardrails
- Only the workspace `rerun-fixtures`. Never list/read/modify anything else in the org beyond what `ensure-workspace.sh` needs to check existence.
- No cloud providers (no AWS/GCP/Azure). No secrets in files. No `ENABLE_TF_OPERATIONS`. No sub-agents.
- If the Actions runner cannot reach HCP Terraform or the token lacks permissions, stop and report precisely.

## Done
- PR title `W0-B: baseline config, Actions apply, 11 seeded scenarios, workspace`. **Do not merge.** Report: PR URL, Actions status, workspace id, the RESULTS table, and any scenario whose failure class differs from the plan (so the app's expectations can be corrected).
