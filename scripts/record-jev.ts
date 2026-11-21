import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `Record the live Jev triage answer for scenarios from their recorded MCP fixtures.

Usage:
  npm run record:jev -- [--scenario <name>]...

Options:
  --scenario   Scenario directory under fixtures/scenarios/ (repeatable). Default: every scenario with a
               recording.json.
  --help       Show this help.

Needs JEV_API_KEY. For each scenario: serves fixtures/scenarios/<name>/mcp/** from the in-process mock MCP
server, runs collectRunArtifacts for the recorded run id, calls triage() with the Jev provider and writes
fixtures/scenarios/<name>/jev.json through recordDecision (the npm script sets RERUN_RECORD=1).`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { scenario: { type: 'string', multiple: true }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  await import('./load-env');
  const { loadConfig, requireLive } = await import('../src/config');
  const { startMockServer } = await import('../src/mcp/mock/server');
  const { createTerraformMcp } = await import('../src/mcp/terraform');
  const { collectRunArtifacts } = await import('../src/mcp/collect');
  const { SCENARIOS_DIR } = await import('../src/mcp/fixtures');
  const { JevDecisionProvider } = await import('../src/decisions/jev');
  const { recordDecision } = await import('../src/decisions/recorded');
  const { route } = await import('../src/decisions/routing');
  const { triage } = await import('../src/agents/triage');

  if (process.env.RERUN_RECORD !== '1')
    throw new Error('RERUN_RECORD=1 is required (use npm run record:jev)');
  const cfg = requireLive(['jev'], loadConfig());
  const scenarios =
    values.scenario ??
    readdirSync(SCENARIOS_DIR)
      .filter((name) => {
        try {
          readFileSync(path.join(SCENARIOS_DIR, name, 'recording.json'));
          return true;
        } catch {
          return false;
        }
      })
      .sort();

  const server = await startMockServer({ port: 0 });
  try {
    for (const scenario of scenarios) {
      const recording = JSON.parse(
        readFileSync(path.join(SCENARIOS_DIR, scenario, 'recording.json'), 'utf8'),
      ) as { runId: string };
      const mcp = await createTerraformMcp({
        url: `${server.url}?scenario=${scenario}`,
        org: cfg.tfeOrg ?? 'recorded',
        workspace: cfg.workspace,
      });
      const artifacts = await collectRunArtifacts(mcp, recording.runId).finally(() => mcp.close());
      const provider = recordDecision(new JevDecisionProvider({ apiKey: cfg.jevApiKey }), { scenario });
      const { result } = await triage(
        {
          incidentId: `record-${scenario}`,
          runId: recording.runId,
          workspace: cfg.workspace,
          artifacts,
          repo: { owner: 'tayden-b', name: 'rerun-fixtures', baseBranch: 'main', headSha: 'recorded' },
        },
        provider,
      );
      const fc = result.failureClass;
      console.log(
        [
          scenario,
          `stage=${result.stage}`,
          `class=${fc.choice}(${fc.confidence.toFixed(2)})`,
          `config_fixable=${result.configFixable.noul.toFixed(2)}`,
          `blast_radius=${result.blastRadius.score.toFixed(2)}`,
          `needs_human=${result.needsHuman.noul.toFixed(2)}`,
          `route=${route(result)}`,
        ].join(' '),
      );
    }
  } finally {
    await server.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
