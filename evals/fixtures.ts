import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extractErrorExcerpt } from '../src/shared/excerpt';
import type { IncidentContext, RunArtifacts, Stage } from '../src/shared/types';
import { expectedSchema, type Expected } from './schema';

export const DEFAULT_SCENARIOS_DIR = path.join(process.cwd(), 'fixtures', 'scenarios');

export interface Scenario {
  name: string;
  dir: string;
  placeholder: boolean;
  expected: Expected;
  context: IncidentContext;
  /** Raw `jev.json` (recorded decision), when present. */
  recordedDecision?: unknown;
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

function asText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  return JSON.stringify(value);
}

const INIT_ERROR =
  /Error: (Failed to (query|install|download)|Module not installed|Unreadable module|Invalid (provider|module) |Inconsistent dependency lock|Unsupported Terraform Core version|Could not (load|retrieve))/;

function hasError(log: string | undefined): log is string {
  return !!log && /Error:/.test(log);
}

/** Stage of the failing phase: apply logs with an error → apply; init-time errors → init; else plan. */
export function deriveStage(planLogs: string | undefined, applyLogs: string | undefined): Stage {
  if (hasError(applyLogs)) return 'apply';
  if (planLogs && INIT_ERROR.test(planLogs)) return 'init';
  return 'plan';
}

function prop(value: unknown, ...keys: string[]): unknown {
  let cur = value;
  for (const key of keys) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Builds `RunArtifacts` from a scenario's recorded MCP outputs (same shape `collectRunArtifacts` returns). */
export function buildArtifacts(dir: string): RunArtifacts {
  const planLogs = asText(readToolFixture(dir, 'get_plan_logs'));
  const applyLogs = asText(readToolFixture(dir, 'get_apply_logs'));
  const stage = deriveStage(planLogs, applyLogs);
  const failingLog = stage === 'apply' ? applyLogs : (planLogs ?? applyLogs);
  return {
    run: readToolFixture(dir, 'get_run_details'),
    workspace: readToolFixture(dir, 'get_workspace_details'),
    planLogs,
    planJson: readToolFixture(dir, 'get_plan_json_output'),
    applyLogs,
    stateVersion: readToolFixture(dir, 'get_state_version'),
    stage,
    errorExcerpt: extractErrorExcerpt(failingLog ?? ''),
  };
}

export function loadScenario(dir: string): Scenario {
  const name = path.basename(dir);
  const rawExpected = readJson(path.join(dir, 'expected.json'));
  const expected = expectedSchema.parse(rawExpected);
  const artifacts = buildArtifacts(dir);
  const runId = prop(artifacts.run, 'id');
  const workspace = prop(artifacts.workspace, 'attributes', 'name');
  const jevFile = path.join(dir, 'jev.json');
  return {
    name,
    dir,
    placeholder: expected.placeholder === true,
    expected,
    recordedDecision: existsSync(jevFile) ? readJson(jevFile) : undefined,
    context: {
      incidentId: `eval-${name}`,
      runId: typeof runId === 'string' ? runId : `run-${name}`,
      workspace: typeof workspace === 'string' ? workspace : 'rerun-fixtures',
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

export function loadScenarios(scenariosDir: string = DEFAULT_SCENARIOS_DIR, only?: string[]): Scenario[] {
  const names = listScenarios(scenariosDir);
  const missing = (only ?? []).filter((n) => !names.includes(n));
  if (missing.length > 0)
    throw new Error(`Unknown or incomplete scenario(s) in ${scenariosDir}: ${missing.join(', ')}`);
  return names.filter((n) => !only || only.includes(n)).map((n) => loadScenario(path.join(scenariosDir, n)));
}
