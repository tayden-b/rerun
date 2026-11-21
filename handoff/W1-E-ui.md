# Task: Rerun — dashboard UI (incident list + war room) with shadcn AI Elements

Repo: https://github.com/tayden-b/rerun — branch `work/w1e-ui` off `dev`, PR into `dev`.
Model: judgment. Read `AGENTS.md`, `handoff/SPEC.md` (§6, §7, §11) and the merged W0-A scaffold first. Git identity per `AGENTS.md`. No credentials needed; everything renders from the DB and fixtures in demo mode.

## Owned paths
`app/**` except `app/api/webhook/**` and `app/api/incidents/*/approve|request-changes` (Wave 2), `components/**`, `lib/ui/**`, `test/ui/**`, `public/**`. You may add read-only API routes you need (`app/api/incidents/route.ts`, `app/api/incidents/[id]/route.ts`, `app/api/incidents/stream/route.ts` SSE) using the W0-A repository layer `src/db/incidents.ts`.

## Required behaviour
Build SPEC §7 exactly, using **AI Elements from shadcn/ui** (`https://ui.shadcn.com/docs/ai-elements` — patterns are copied into the project via the shadcn CLI; do not install the deprecated `ai-elements` npm CLI). Patterns to use: `Trace` (investigation steps), `Subagent` (Config/Reality panels), `Code Block` in diff mode (patch), `Stack Trace` (error excerpt), `Terminal` (verifier output), `Confirmation` (Approve / Request changes), plus shadcn `Badge`, `Card`, `Progress`/custom bars for the Jev probabilities, `Tooltip`, `Skeleton`.

1. `/` incident list: table with status pill (colour per `IncidentStatus`), failure class badge, workspace, run id (link `https://app.terraform.io/app/<org>/workspaces/<ws>/runs/<runId>`), relative age, PR link, cost. Filters: status, class. Empty state that explains how to trigger one (`scripts/break.sh …`) and the demo command. Live via SSE (`/api/incidents/stream` emits `incident.updated` on DB changes — poll the DB every 2s server-side in this iteration).
2. `/incidents/[id]` war room per SPEC §7 (header, Triage card with four probability bars and the `Stack Trace`, Investigation `Trace` with two `Subagent` panels that expand tool calls, Fix diff per file with rationale, Verification `Terminal`, `Confirmation` footer, cost/duration footer). Streams events live over SSE while the incident is in progress; all sections render gracefully when their data is not there yet (`Skeleton`, not blank). Approve/Request-changes buttons `POST /api/incidents/[id]/approve` / `/request-changes` with `{ comment? }` — the routes are Wave 2's; wire the buttons and show the optimistic state + error toast when the route 404s.
3. Visual: dark by default (`class="dark"` on `<html>`), one accent colour, dense but calm layout, monospace for ids/logs, no emoji, no marketing copy. Sidebar-less; top bar with the product name, workspace, and a mode badge (`demo`/`live`). Must look excellent in a 1280×800 screenshot — this page is the README GIF. Reference quality bar: Vercel's dashboard, Linear.
4. Demo data: `scripts/seed-demo.ts` (`npm run seed:demo`) inserts 3 incidents from the fixtures — one `resolved`, one `awaiting_approval` with the full event stream (triage decision, two subagents with tool calls, patch, verify output), one `needs_human` draft — so screenshots and tests are deterministic. The events should look like what the real pipeline will write (use SPEC §6 `kind`s and the SPEC §2 `step` names: `collect`, `triage`, `diagnose:config`, `diagnose:reality`, `fix`, `verify`, `propose`, `await`, `confirm`).
5. Playwright (`npm run test:e2e`, Chromium only): seeds, opens `/`, asserts 3 rows; opens the `awaiting_approval` incident, asserts Triage bars, two Subagent panels, a diff block, Terminal output and an enabled Approve button; takes `test/ui/__screenshots__/{list,war-room}.png` at 1280×800 (committed, used in the PR description and later the README).

## Tests
- Vitest component tests for the probability bar, status pill mapping (every `IncidentStatus` has a colour), relative time.
- Playwright flow above passes in CI (install browsers in the workflow; cache them).

## Guardrails
- No credentials. Do not implement approve/merge logic — buttons only. No suppressions, no sub-agents, pinned deps. Do not restyle shadcn primitives globally beyond the theme tokens.

## Done
- CI green. PR title `W1-E: dashboard — incident list and war room`. **Do not merge.** Report: PR URL, CI, both screenshots embedded in the PR description, the SSE contract you implemented, and the exact request bodies the approve/request-changes buttons send.


## Orchestrator notes (added after cross-brief review — these override anything above)
- **Credentials in your env**: the scoped keys this brief allows you to use are org secrets that may not be in your shell env by default. Bind them per command via exec `env`, e.g. `{"JEV_API_KEY": "secret:org:JEV_API_KEY"}`, `{"RERUN_ANTHROPIC_API_KEY": "secret:org:RERUN_ANTHROPIC_API_KEY"}`, `{"TFE_TOKEN": "secret:org:TFE_TOKEN", "TFE_ORG": "secret:org:TFE_ORG"}`, `{"GITHUB_TOKEN": "secret:org:GITHUB_TOKEN"}`. Only the ones your brief names. Never print/echo/commit values. GitHub CI never has them.
- **Workspace scope**: touch only the HCP Terraform workspace `rerun-fixtures` in `hashi-org-TF`. Never set `ENABLE_TF_OPERATIONS`.
- **Shared files** (`package.json`, `package-lock.json`, `.github/workflows/ci.yml`): six Wave 1 workers run in parallel. Only add your deps/scripts to `package.json` (pinned, `save-exact`); do not reorder or reformat it. Do not edit `.github/workflows/ci.yml` unless this brief says so. Before your final push, `git merge origin/dev`; on lockfile conflicts take `dev`'s lockfile and re-run `npm install` to regenerate, never hand-edit it.
- **AI SDK 6 / MCP API names**: where a brief names an API (`generateObject`, `experimental_createMCPClient`, `MockLanguageModelV3`), use the current non-deprecated equivalent in the pinned version (e.g. `generateText` with `output: Output.object(...)`, `createMCPClient` from `@ai-sdk/mcp`) and note the choice in your PR.
- Do not change `src/shared/types.ts`. If a SPEC §11 type genuinely blocks you, explain in the PR and update `handoff/SPEC.md` §11 in the same PR.
- Work fast: compute is free; the orchestrator is waiting on your PR to start the next wave.
- CI for Playwright: add a **separate** workflow `.github/workflows/e2e.yml` (Node 24, `npm ci`, `npx playwright install --with-deps chromium` with cache, `npm run test:e2e`, upload the screenshots as an artifact). Do not edit `ci.yml`.
- Bar: Tayden wants modern, clean, professional (Vercel/Linear/devin.ai), never "AI-generated" looks: no chip walls, no terminal cosplay outside the Verification block, no bold-text walls, no taglines. The orchestrator will reject light-themed, cluttered or generic results.
- `scripts/seed-demo.ts` must not depend on W1-A/W1-B/W1-C code; build events from the fixture JSON directly.
