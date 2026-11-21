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

| Provider | Scenarios | Class accuracy | Route accuracy | Mean latency | Mean input tokens | Cost / incident |
| -------- | --------- | -------------- | -------------- | ------------ | ----------------- | --------------- |
| jev      | —         | —              | —              | —            | —                 | —               |
| llm      | —         | —              | —              | —            | —                 | —               |

<!-- evals:end -->
