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
const PROVIDER_BLOCK = /^\s*provider\s+"([^"]+)"/gm;
const REQUIRED_PROVIDERS = /\brequired_providers\s*\{/g;
const PROVIDER_ENTRY = /^\s*"?([A-Za-z0-9_-]+)"?\s*=/;

const HEREDOC_START = /<<-?([A-Za-z_][A-Za-z0-9_-]*)[^\n]*\n/y;
const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * HCL with comments and heredoc bodies blanked out (quoted strings kept), so neither their braces nor
 * their text count as configuration. Unterminated comments/heredocs are left as-is (fail closed).
 */
export function stripHclComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '<' && text[i + 1] === '<') {
      HEREDOC_START.lastIndex = i;
      const start = HEREDOC_START.exec(text);
      const bodyStart = start ? i + start[0].length : -1;
      const end = start ? new RegExp(`^[ \\t]*${start[1]}[ \\t]*$`, 'm').exec(text.slice(bodyStart)) : null;
      if (!start || !end) {
        out += ch;
        i++;
        continue;
      }
      const stop = bodyStart + end.index + end[0].length;
      out += text.slice(i, bodyStart) + blank(text.slice(bodyStart, stop));
      i = stop;
    } else if (ch === '#' || (ch === '/' && text[i + 1] === '/')) {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) {
        out += text.slice(i);
        break;
      }
      out += blank(text.slice(i, end + 2));
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Bodies of every `required_providers { ... }` block (brace-matched). */
function requiredProvidersBodies(text: string): string[] {
  const bodies: string[] = [];
  for (const m of text.matchAll(REQUIRED_PROVIDERS)) {
    const start = (m.index ?? 0) + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    bodies.push(text.slice(start, i - 1));
  }
  return bodies;
}

/** Top-level entries of `required_providers` blocks: local name -> its source/version text. */
function requiredProviders(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const body of requiredProvidersBodies(text)) {
    let depth = 0;
    let name: string | undefined;
    for (const line of body.split('\n')) {
      if (depth === 0) name = PROVIDER_ENTRY.exec(line)?.[1];
      if (name !== undefined) out.set(name, `${out.get(name) ?? ''}${line}\n`);
      depth = Math.max(0, depth + (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0));
      if (depth === 0) name = undefined;
    }
  }
  return out;
}

const SOURCE_VALUE = /source\s*=\s*"([^"]+)"/;

/** Multiset of `provider "x"` blocks, so an extra aliased block counts as an addition. */
function providerBlockCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(PROVIDER_BLOCK)) out.set(m[1], (out.get(m[1]) ?? 0) + 1);
  return out;
}

function addedProviders(rawBefore: string, rawAfter: string): string[] {
  const [before, after] = [stripHclComments(rawBefore), stripHclComments(rawAfter)];
  const added: string[] = [];
  const had = providerBlockCounts(before);
  for (const [name, count] of providerBlockCounts(after)) {
    if (count > (had.get(name) ?? 0)) added.push(`provider "${name}"`);
  }
  const hadRequired = requiredProviders(before);
  for (const [name, entry] of requiredProviders(after)) {
    const previous = hadRequired.get(name);
    if (previous === undefined) added.push(`required_providers.${name}`);
    else if (SOURCE_VALUE.exec(entry)?.[1] !== SOURCE_VALUE.exec(previous)?.[1]) {
      added.push(`required_providers.${name} source`);
    }
  }
  return added;
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
  const added = addedProviders(before ?? '', after);
  if (added.length > 0) return `adding providers is not allowed (${added.join(', ')})`;
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
