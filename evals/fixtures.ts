import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from '../src/config';
import { collectRunArtifacts } from '../src/mcp/collect';
import { startMockServer, type MockServerHandle } from '../src/mcp/mock/server';
import { createTerraformMcp } from '../src/mcp/terraform';
import type { IncidentContext, RunArtifacts } from '../src/shared/types';
import { expectedSchema, type Expected } from './schema';

const DEFAULT_ORG = 'hashi-org-TF';
export const DEFAULT_SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');

export interface Scenario {
  name: string;
  dir: string;
  placeholder: boolean;
  expected: Expected;
  context: IncidentContext;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Reads a recorded MCP tool result: `mcp/<tool>.json`, else the first `mcp/<tool>.<argHash>.json`.
 * Files are `{ "placeholder"?: true, "result": <tool output> }` (W1-A layout); a bare value is used as is.
 */
export function readToolFixture(dir: string, tool: string): unknown {
  const mcpDir = path.join(dir, 'mcp');
  if (!existsSync(mcpDir)) return undefined;
  const exact = path.join(mcpDir, `${tool}.json`);
  const file = existsSync(exact)
    ? exact
    : readdirSync(mcpDir)
        .filter((f) => f.startsWith(`${tool}.`) && f.endsWith('.json'))
        .sort()
        .map((f) => path.join(mcpDir, f))[0];
  if (!file) return undefined;
  const parsed = readJson(file);
  if (parsed && typeof parsed === 'object' && 'result' in parsed)
    return (parsed as { result: unknown }).result;
  return parsed;
}

/** Run id of the recorded `get_run_details` (JSON:API `{ data: { id } }`). */
function recordedRunId(dir: string): string {
  const raw = readJson(path.join(dir, 'mcp', 'get_run_details.json')) as { result?: unknown };
  const result = (raw.result ?? raw) as { data?: { id?: unknown }; id?: unknown };
  const id = result.data?.id ?? result.id;
  if (typeof id !== 'string') throw new Error(`${dir}/mcp/get_run_details.json has no run id`);
  return id;
}

/**
 * Collects artifacts exactly as production does: W1-A's `collectRunArtifacts` against the
 * in-process mock MCP server serving `<scenariosDir>/<name>/mcp/`.
 */
async function collectScenario(mock: MockServerHandle, dir: string, config: Config): Promise<RunArtifacts> {
  const mcp = await createTerraformMcp({
    url: `${mock.url}?scenario=${encodeURIComponent(path.basename(dir))}`,
    org: config.tfeOrg ?? DEFAULT_ORG,
    workspace: config.workspace,
  });
  try {
    return await collectRunArtifacts(mcp, recordedRunId(dir));
  } finally {
    await mcp.close();
  }
}

async function loadScenario(mock: MockServerHandle, dir: string, config: Config): Promise<Scenario> {
  const name = path.basename(dir);
  const expected = expectedSchema.parse(readJson(path.join(dir, 'expected.json')));
  const artifacts = await collectScenario(mock, dir, config);
  return {
    name,
    dir,
    placeholder: expected.placeholder === true,
    expected,
    context: {
      incidentId: `eval-${name}`,
      runId: recordedRunId(dir),
      workspace: config.workspace,
      artifacts,
      repo: { owner: 'tayden-b', name: 'rerun-fixtures', baseBranch: 'main', headSha: '' },
    },
  };
}

/** Every `<dir>/<name>/` that has both `expected.json` and recorded MCP outputs, sorted by name. */
export function listScenarios(scenariosDir: string = DEFAULT_SCENARIOS_DIR): string[] {
  if (!existsSync(scenariosDir)) return [];
  return readdirSync(scenariosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter(
      (name) =>
        existsSync(path.join(scenariosDir, name, 'expected.json')) &&
        existsSync(path.join(scenariosDir, name, 'mcp')),
    )
    .sort();
}

export async function loadScenarios(
  scenariosDir: string = DEFAULT_SCENARIOS_DIR,
  only?: string[],
  config: Config = loadConfig(),
): Promise<Scenario[]> {
  const names = listScenarios(scenariosDir);
  const missing = (only ?? []).filter((n) => !names.includes(n));
  if (missing.length > 0)
    throw new Error(`Unknown or incomplete scenario(s) in ${scenariosDir}: ${missing.join(', ')}`);
  const mock = await startMockServer({ port: 0, fixturesDir: scenariosDir });
  try {
    const scenarios: Scenario[] = [];
    for (const n of names.filter((n) => !only || only.includes(n))) {
      scenarios.push(await loadScenario(mock, path.join(scenariosDir, n), config));
    }
    return scenarios;
  } finally {
    await mock.close();
  }
}
