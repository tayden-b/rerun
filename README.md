# Rerun

When an HCP Terraform run fails, Rerun diagnoses it through the Terraform MCP server, decides with a typed decision model (Jev) how serious and how fixable it is, writes the smallest fix, proves the fix with a real speculative plan, opens the PR, and shows the whole investigation in a dashboard where a human approves the merge.

- Specification: [`handoff/SPEC.md`](handoff/SPEC.md)
- Worker rules and commands: [`AGENTS.md`](AGENTS.md)
- Build status: [`docs/BUILD-STATUS.md`](docs/BUILD-STATUS.md)

## Quick start (no credentials)

```bash
npm ci
npm run demo   # mock Terraform MCP on :8080, seeded placeholder incident, app on http://localhost:3000
```

Live mode needs the variables in `.env.example` and the Terraform MCP sidecar: `docker compose up terraform-mcp`.

## Evals

`npm run eval` scores triage on every recorded scenario; `npm run eval:readme` renders `evals/results.json` here.

<!-- evals:start -->

Generated 2026-11-21 from `evals/results.json`: 11 scenario(s), 2 perturbation(s) per scenario, prices as of 2026-11-20.

### Triage accuracy

| Provider | Scenarios | Errors | Class accuracy | Route accuracy | Mean latency | Mean input tokens | Cost / incident |
| -------- | --------- | ------ | -------------- | -------------- | ------------ | ----------------- | --------------- |
| jev      | 11        | 0      | 100%           | 100%           | 57 ms        | 1410              | $0.000059       |
| llm      | 11        | 0      | 100%           | 91%            | 2635 ms      | 3733              | $0.000373       |

### Per-class precision and recall

| Provider | Class                 | Support | Predicted | Precision | Recall |
| -------- | --------------------- | ------- | --------- | --------- | ------ |
| jev      | `config_syntax`       | 2       | 2         | 100%      | 100%   |
| jev      | `config_reference`    | 1       | 1         | 100%      | 100%   |
| jev      | `missing_input`       | 1       | 1         | 100%      | 100%   |
| jev      | `provider_version`    | 1       | 1         | 100%      | 100%   |
| jev      | `provider_api_error`  | 1       | 1         | 100%      | 100%   |
| jev      | `apply_runtime`       | 1       | 1         | 100%      | 100%   |
| jev      | `precondition_failed` | 2       | 2         | 100%      | 100%   |
| jev      | `module_source`       | 1       | 1         | 100%      | 100%   |
| jev      | `dependency_cycle`    | 1       | 1         | 100%      | 100%   |
| llm      | `config_syntax`       | 2       | 2         | 100%      | 100%   |
| llm      | `config_reference`    | 1       | 1         | 100%      | 100%   |
| llm      | `missing_input`       | 1       | 1         | 100%      | 100%   |
| llm      | `provider_version`    | 1       | 1         | 100%      | 100%   |
| llm      | `provider_api_error`  | 1       | 1         | 100%      | 100%   |
| llm      | `apply_runtime`       | 1       | 1         | 100%      | 100%   |
| llm      | `precondition_failed` | 2       | 2         | 100%      | 100%   |
| llm      | `module_source`       | 1       | 1         | 100%      | 100%   |
| llm      | `dependency_cycle`    | 1       | 1         | 100%      | 100%   |

### Calibration

Outcome: `autoPr` in `expected.json` means config-fixable = 1 and needs-human = 0. ECE = expected calibration error over 0.1-wide bins (lower is better).

| Provider | Signal           | n   | ECE  |
| -------- | ---------------- | --- | ---- |
| jev      | `config_fixable` | 11  | 0.20 |
| jev      | `needs_human`    | 11  | 0.26 |
| llm      | `config_fixable` | 11  | 0.07 |
| llm      | `needs_human`    | 11  | 0.16 |

| Provider | Signal           | Bin     | n   | Mean predicted | Observed |
| -------- | ---------------- | ------- | --- | -------------- | -------- |
| jev      | `config_fixable` | 0.8–0.9 | 2   | 0.82           | 0.00     |
| jev      | `config_fixable` | 0.9–1.0 | 9   | 0.94           | 1.00     |
| jev      | `needs_human`    | 0.1–0.2 | 4   | 0.16           | 0.00     |
| jev      | `needs_human`    | 0.2–0.3 | 2   | 0.27           | 0.00     |
| jev      | `needs_human`    | 0.3–0.4 | 3   | 0.32           | 0.00     |
| jev      | `needs_human`    | 0.5–0.6 | 1   | 0.53           | 1.00     |
| jev      | `needs_human`    | 0.7–0.8 | 1   | 0.77           | 1.00     |
| llm      | `config_fixable` | 0.7–0.8 | 2   | 0.72           | 0.50     |
| llm      | `config_fixable` | 0.8–0.9 | 5   | 0.84           | 0.80     |
| llm      | `config_fixable` | 0.9–1.0 | 4   | 0.96           | 1.00     |
| llm      | `needs_human`    | 0.0–0.1 | 4   | 0.04           | 0.00     |
| llm      | `needs_human`    | 0.1–0.2 | 1   | 0.15           | 0.00     |
| llm      | `needs_human`    | 0.2–0.3 | 2   | 0.20           | 0.00     |
| llm      | `needs_human`    | 0.3–0.4 | 2   | 0.30           | 0.00     |
| llm      | `needs_human`    | 0.8–0.9 | 2   | 0.80           | 1.00     |

### Robustness

Each scenario state is perturbed without changing its meaning (consistent resource renames, an extra UUID line, reordered plan entries, whitespace). A flip is a run whose class or route differs from the unperturbed run.

| Provider | Perturbed runs | Flips | Flip rate |
| -------- | -------------- | ----- | --------- |
| jev      | 22             | 0     | 0%        |
| llm      | 22             | 0     | 0%        |

### End-to-end (live)

| Scenario | Reached status | Verifier passed | PR  | fixTouches respected | Duration |
| -------- | -------------- | --------------- | --- | -------------------- | -------- |
| not run  | —              | —               | —   | —                    | —        |

- LLM decision cost counts input tokens only (DecisionProvider does not report output tokens).

<!-- evals:end -->
