import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `Record real Terraform MCP outputs for a scenario (live mode; needs the real server running).

Usage:
  npm run record -- --scenario <name> --run <runId> [--url <mcpUrl>] [--workspace <name>]

Options:
  --scenario   Scenario directory under fixtures/scenarios/ (e.g. apply-time-exit-1). Required.
  --run        HCP Terraform run id (run-...) in the scoped workspace. Required.
  --url        MCP endpoint. Default: TERRAFORM_MCP_URL or http://127.0.0.1:8080/mcp.
  --workspace  Workspace. Default: RERUN_WORKSPACE or rerun-fixtures. TFE_ORG must be set.
  --help       Show this help.

Before running: start the real server with \`TFE_TOKEN=... docker compose up -d terraform-mcp\`.

Calls every tool collectRunArtifacts uses for the run, plus list_runs (workspace) and whoami, and writes:
  fixtures/scenarios/<name>/mcp/<tool>.json   redacted { tool, args, result } per call (the directory is
                                              cleared first, so re-running overwrites). A tool called with
                                              several argument sets is written as <tool>.<argHash>.json each.
  fixtures/scenarios/<name>/recording.json    { runId, recordedAt, stage, server, tools: [...] }
Org/workspace arguments are not stored (the client injects them). Logs, URLs and identities are scrubbed.`;

interface Recorded {
  tool: string;
  args: Record<string, unknown>;
  text: string;
  isError: boolean;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      run: { type: 'string' },
      url: { type: 'string' },
      workspace: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help || !values.scenario || !values.run) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  await import('./load-env');
  const { loadConfig, requireLive } = await import('../src/config');
  const { createTerraformMcp } = await import('../src/mcp/terraform');
  const { collectRunArtifacts } = await import('../src/mcp/collect');
  const { argHash, fixtureArgs, SCENARIOS_DIR } = await import('../src/mcp/fixtures');
  const { parseToolText } = await import('../src/mcp/parse');
  const { scrubToolOutput, scrubWhoami } = await import('../src/mcp/scrub');

  const cfg = requireLive(['tfe'], loadConfig());
  const workspace = values.workspace ?? cfg.workspace;
  const url = values.url ?? cfg.terraformMcpUrl;
  const mcp = await createTerraformMcp({ url, workspace, org: cfg.tfeOrg as string });

  const calls: Recorded[] = [];
  const recorder = mcp.withObserver((e) => {
    if (e.phase === 'result') calls.push({ tool: e.tool, args: e.args, text: e.result.text, isError: false });
    if (e.phase === 'error') calls.push({ tool: e.tool, args: e.args, text: e.error.message, isError: true });
  });

  const artifacts = await collectRunArtifacts(recorder, values.run, (ev) => {
    if (ev.kind !== 'tool_result') console.log(`${ev.kind.padEnd(11)} ${ev.title}`);
  });
  await recorder.listRuns({ pageSize: 20 });
  await recorder.whoami();
  await mcp.close();

  const dir = path.join(SCENARIOS_DIR, values.scenario, 'mcp');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith('.json')) rmSync(path.join(dir, f));

  const counts = new Map<string, Set<string>>();
  for (const c of calls) {
    const set = counts.get(c.tool) ?? new Set<string>();
    set.add(argHash(c.args));
    counts.set(c.tool, set);
  }

  const written = new Map<string, { tool: string; file: string; args: Record<string, unknown> }>();
  for (const c of calls) {
    const multi = (counts.get(c.tool)?.size ?? 0) > 1;
    const file = multi ? `${c.tool}.${argHash(c.args)}.json` : `${c.tool}.json`;
    const parsed = parseToolText(scrubToolOutput(c.text));
    let result: unknown =
      parsed && typeof parsed === 'object' && 'text' in parsed && Object.keys(parsed).length === 1
        ? (parsed as { text: string }).text
        : parsed;
    if (c.tool === 'whoami') result = scrubWhoami(result);
    const args = JSON.parse(scrubToolOutput(JSON.stringify(fixtureArgs(c.args)))) as Record<string, unknown>;
    const body = { tool: c.tool, args, ...(c.isError ? { isError: true } : {}), result };
    writeFileSync(path.join(dir, file), `${JSON.stringify(body, null, 2)}\n`);
    written.set(file, { tool: c.tool, file: `mcp/${file}`, args });
  }

  const recording = {
    runId: values.run,
    recordedAt: new Date().toISOString(),
    stage: artifacts.stage,
    server: 'hashicorp/terraform-mcp-server:1.4',
    tools: [...written.values()],
  };
  writeFileSync(
    path.join(SCENARIOS_DIR, values.scenario, 'recording.json'),
    `${JSON.stringify(recording, null, 2)}\n`,
  );
  console.log(
    `recorded ${written.size} files for ${values.scenario} (run ${values.run}, stage ${artifacts.stage})`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
