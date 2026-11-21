import { createHash } from 'node:crypto';
import path from 'node:path';

/** Arguments the client injects from its scope; they never select a fixture variant. */
export const SCOPE_ARGS = ['terraform_org_name', 'workspace_name', 'workspace_id'] as const;

export const FIXTURES_ROOT = path.join(process.cwd(), 'fixtures');
export const SCENARIOS_DIR = path.join(FIXTURES_ROOT, 'scenarios');
export const TOOLS_LIST_PATH = path.join(FIXTURES_ROOT, 'mcp', 'tools-list.json');

/** Recorded tool output: `result` is parsed JSON when the server returned JSON text, else the text itself. */
export interface ToolFixture {
  placeholder?: true;
  tool?: string;
  args?: Record<string, unknown>;
  isError?: true;
  result: unknown;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export function fixtureArgs(args: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([k, v]) => v !== undefined && !(SCOPE_ARGS as readonly string[]).includes(k),
    ),
  );
}

/**
 * Fixture variant key: first 10 hex chars of sha256 over the canonical JSON (keys sorted recursively)
 * of the call arguments minus the scope arguments (`SCOPE_ARGS`). `<tool>.<hash>.json` is only written
 * when a recording called the same tool with more than one argument set; otherwise `<tool>.json`.
 */
export function argHash(args: Record<string, unknown> = {}): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(fixtureArgs(args))))
    .digest('hex')
    .slice(0, 10);
}

/** Files the mock tries, in order, for a call. */
export function fixtureCandidates(tool: string, args: Record<string, unknown> = {}): string[] {
  return [`${tool}.${argHash(args)}.json`, `${tool}.json`];
}
