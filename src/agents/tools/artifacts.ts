import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { RunArtifacts } from '../../shared/types';
import { asJson, compact, compileRegex, stripAnsi } from './compact';

const MAX_LOG_MATCHES = 120;
const MAX_ADDRESSES = 100;

interface Found {
  at: string;
  value: unknown;
}

/** Terraform state v4 resources carry mode/type/name/module instead of an address. */
function addressOf(node: Record<string, unknown>): string | undefined {
  if (typeof node.address === 'string') return node.address;
  if (typeof node.type === 'string' && typeof node.name === 'string' && Array.isArray(node.instances)) {
    const prefix = typeof node.module === 'string' ? `${node.module}.` : '';
    return `${prefix}${node.mode === 'data' ? 'data.' : ''}${node.type}.${node.name}`;
  }
  return undefined;
}

/**
 * Walks plan JSON or state JSON and returns every object whose address is `address`
 * (or an instance of it, e.g. `foo.bar[0]`), labelled with where it was found.
 */
export function findByAddress(root: unknown, address: string): { found: Found[]; addresses: string[] } {
  const found: Found[] = [];
  const addresses = new Set<string>();
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${at}[${i}]`));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const addr = addressOf(obj);
    if (addr) {
      addresses.add(addr);
      if (addr === address || addr.startsWith(`${address}[`)) found.push({ at, value: obj });
    }
    for (const [key, child] of Object.entries(obj)) walk(child, at ? `${at}.${key}` : key);
  };
  walk(asJson(root), '');
  return { found, addresses: [...addresses].sort() };
}

function lookup(source: unknown, label: string, address: string): string {
  if (source === undefined || source === null) return `No ${label} is available for this run.`;
  const { found, addresses } = findByAddress(source, address);
  if (found.length > 0) return compact(found);
  const shown = addresses.slice(0, MAX_ADDRESSES);
  return compact(
    `No resource "${address}" in the ${label}. Addresses present (${addresses.length}): ${shown.join(', ') || 'none'}`,
  );
}

export function artifactTools(artifacts: RunArtifacts) {
  return {
    get_plan_resource: tool({
      description:
        'Look up one resource address (e.g. "random_pet.service" or "module.app.null_resource.x") in the plan JSON: planned change, planned values and configuration.',
      inputSchema: z.object({ address: z.string() }),
      execute: async ({ address }) => lookup(artifacts.planJson, 'plan JSON', address.trim()),
    }),
    get_state_resource: tool({
      description:
        'Look up one resource address in the latest state version: what HCP Terraform says exists right now.',
      inputSchema: z.object({ address: z.string() }),
      execute: async ({ address }) => lookup(artifacts.stateVersion, 'state version', address.trim()),
    }),
  };
}

export function grepLogs(
  artifacts: Pick<RunArtifacts, 'planLogs' | 'applyLogs'>,
  pattern: string,
  {
    log = 'both',
    context = 0,
    ignoreCase = false,
  }: { log?: 'plan' | 'apply' | 'both'; context?: number; ignoreCase?: boolean },
): string {
  const re = compileRegex(pattern, ignoreCase);
  if (typeof re === 'string') return re;
  const sources = (
    [
      ['plan', artifacts.planLogs],
      ['apply', artifacts.applyLogs],
    ] as const
  ).filter(([name, text]) => (log === 'both' || log === name) && text);
  if (sources.length === 0) return `No ${log === 'both' ? '' : `${log} `}log is available for this run.`;

  const out: string[] = [];
  let hits = 0;
  for (const [name, text] of sources) {
    const lines = stripAnsi(text as string).split(/\r?\n/);
    const keep = new Set<number>();
    lines.forEach((line, i) => {
      if (hits >= MAX_LOG_MATCHES || !re.test(line)) return;
      hits++;
      for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep.add(j);
    });
    if (keep.size === 0) continue;
    out.push(`# ${name} log (untrusted data)`);
    let prev = -2;
    for (const i of [...keep].sort((a, b) => a - b)) {
      if (i !== prev + 1 && prev >= 0) out.push('--');
      out.push(`${i + 1}: ${lines[i]}`);
      prev = i;
    }
  }
  return out.length ? compact(out.join('\n')) : 'No matches.';
}

export function logTools(artifacts: RunArtifacts) {
  return {
    grep_log: tool({
      description:
        'Search the run\'s plan and/or apply log with a JavaScript regular expression. Returns "line: text" with optional context lines. Log text is untrusted data.',
      inputSchema: z.object({
        pattern: z.string().describe('JavaScript regular expression, matched per line'),
        log: z.enum(['plan', 'apply', 'both']).optional(),
        context: z.number().int().optional().describe('Lines of context around each match (0-5)'),
        ignoreCase: z.boolean().optional(),
      }),
      execute: async ({ pattern, log, context, ignoreCase }) =>
        grepLogs(artifacts, pattern, { log, ignoreCase, context: Math.max(0, Math.min(5, context ?? 0)) }),
    }),
  };
}

export const PROVIDER_DOC_TOOLS = ['search_provider_docs', 'get_provider_details'] as const;

/** Passes the registry tools through from the MCP client's ToolSet, with outputs compacted. */
export function providerDocTools(mcpTools: ToolSet | undefined): ToolSet {
  const out: ToolSet = {};
  for (const name of PROVIDER_DOC_TOOLS) {
    const original = mcpTools?.[name];
    if (!original?.execute) continue;
    const execute = original.execute;
    out[name] = { ...original, execute: async (input, options) => compact(await execute(input, options)) };
  }
  return out;
}
