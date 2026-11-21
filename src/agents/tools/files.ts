import { tool } from 'ai';
import { z } from 'zod';
import type { FailureClass } from '../../shared/types';
import { normalizeRepoPath, type Workdir } from '../workdir';
import { compact, compileRegex } from './compact';

const MAX_MATCHES = 200;

export function fileTools(workdir: Workdir) {
  return {
    list_files: tool({
      description: 'List every file in the repository working copy with its line count.',
      inputSchema: z.object({}),
      execute: async () =>
        compact(
          workdir
            .list()
            .map((file) => `${file} (${(workdir.read(file) ?? '').split('\n').length} lines)`)
            .join('\n'),
        ),
    }),
    read_file: tool({
      description: 'Read one file from the repository working copy (repo-relative path, e.g. "main.tf").',
      inputSchema: z.object({ path: z.string().describe('Repo-relative path') }),
      execute: async ({ path }) => {
        let rel: string;
        try {
          rel = normalizeRepoPath(path);
        } catch (error) {
          return `ERROR: ${(error as Error).message}`;
        }
        const content = workdir.read(rel);
        return content === undefined ? `ERROR: no such file "${rel}"` : compact(content);
      },
    }),
    search_files: tool({
      description:
        'Search every repository file with a JavaScript regular expression. Returns "path:line: text" for each match.',
      inputSchema: z.object({
        pattern: z.string().describe('JavaScript regular expression, matched per line'),
        ignoreCase: z.boolean().optional(),
      }),
      execute: async ({ pattern, ignoreCase }) => {
        const re = compileRegex(pattern, ignoreCase);
        if (typeof re === 'string') return re;
        const hits: string[] = [];
        for (const file of workdir.list()) {
          (workdir.read(file) ?? '').split('\n').forEach((line, i) => {
            if (hits.length < MAX_MATCHES && re.test(line)) hits.push(`${file}:${i + 1}: ${line}`);
          });
        }
        return hits.length ? compact(hits.join('\n')) : 'No matches.';
      },
    }),
  };
}

const PROTECTED_PREFIXES = ['scenarios/', 'baseline/', '.github/'];
const PROVIDER_SOURCE = /source\s*=\s*"([^"]+\/[^"]+)"/g;
const PROVIDER_BLOCK = /^\s*provider\s+"([^"]+)"/gm;

function matches(re: RegExp, text: string): Set<string> {
  return new Set([...text.matchAll(re)].map((m) => m[1]));
}

/**
 * The Fix agent's write guard (SPEC §2 step 4, brief rule 5). Returns a refusal reason, or null if allowed.
 * Only Terraform files; never `scenarios/**`, `baseline/**`, `.github/**`; `versions.tf` and the lock file
 * only for `provider_version`; never a new provider source or provider block.
 */
export function writeRefusal(
  file: string,
  before: string | undefined,
  after: string,
  failureClass: FailureClass | undefined,
): string | null {
  let rel: string;
  try {
    rel = normalizeRepoPath(file);
  } catch (error) {
    return (error as Error).message;
  }
  if (PROTECTED_PREFIXES.some((prefix) => rel.startsWith(prefix))) {
    return `"${rel}" is protected: never edit scenarios/**, baseline/** or .github/**`;
  }
  const base = rel.split('/').at(-1) ?? rel;
  const versionFile = base === 'versions.tf' || base === '.terraform.lock.hcl';
  if (versionFile && failureClass !== 'provider_version') {
    return `"${rel}" may only change when the failure class is provider_version (it is ${failureClass ?? 'unknown'})`;
  }
  if (!versionFile && !/\.(tf|tfvars)$/.test(base)) {
    return `"${rel}" is not a Terraform file (.tf or .tfvars)`;
  }
  for (const re of [PROVIDER_SOURCE, PROVIDER_BLOCK]) {
    const had = matches(re, before ?? '');
    const added = [...matches(re, after)].filter((name) => !had.has(name));
    if (added.length > 0) return `adding providers is not allowed (${added.join(', ')})`;
  }
  return null;
}

export function writeTools(workdir: Workdir, failureClass: FailureClass | undefined) {
  async function save(path: string, after: string, rationale: string) {
    const before = workdir.read(path);
    const refusal = writeRefusal(path, before, after, failureClass);
    if (refusal) return `REFUSED: ${refusal}`;
    if (before === after) return `No change: "${path}" already has this content.`;
    await workdir.write(path, after, rationale.trim());
    return `Wrote ${normalizeRepoPath(path)} (${after.split('\n').length} lines).`;
  }

  return {
    write_file: tool({
      description:
        'Replace the whole content of a Terraform file in the working copy. Keep the existing formatting; change only what the fix needs.',
      inputSchema: z.object({
        path: z.string().describe('Repo-relative path'),
        content: z.string().describe('The complete new file content'),
        rationale: z.string().describe('One sentence: why this file changes'),
      }),
      execute: async ({ path, content, rationale }) => save(path, content, rationale),
    }),
    edit_file: tool({
      description:
        'Replace one exact occurrence of `oldText` with `newText` in a file. Prefer this over write_file for small edits.',
      inputSchema: z.object({
        path: z.string().describe('Repo-relative path'),
        oldText: z.string().describe('Exact text to replace; must occur exactly once'),
        newText: z.string(),
        rationale: z.string().describe('One sentence: why this file changes'),
      }),
      execute: async ({ path, oldText, newText, rationale }) => {
        const before = workdir.read(path);
        if (before === undefined) return `ERROR: no such file "${path}"`;
        const count = oldText === '' ? 0 : before.split(oldText).length - 1;
        if (count !== 1)
          return `ERROR: oldText occurs ${count} times in "${path}"; it must occur exactly once`;
        return save(
          path,
          before.replace(oldText, () => newText),
          rationale,
        );
      },
    }),
  };
}
