import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Patch, PatchFile } from '../shared/types';

export interface Workdir {
  readonly dir: string;
  read(file: string): string | undefined;
  write(file: string, content: string, rationale?: string): Promise<void>;
  list(): string[];
  diff(): PatchFile[];
  cleanup(): Promise<void>;
}

export class WorkdirPathError extends Error {
  constructor(file: string) {
    super(`Path "${file}" is outside the repository working copy`);
    this.name = 'WorkdirPathError';
  }
}

/** Repo-relative POSIX path; rejects absolute paths and `..` escapes. */
export function normalizeRepoPath(file: string): string {
  const posix = file.replace(/\\/g, '/').trim();
  if (posix === '' || posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) throw new WorkdirPathError(file);
  const normalized = path.posix.normalize(posix).replace(/^(\.\/)+/, '');
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new WorkdirPathError(file);
  }
  return normalized;
}

/**
 * Writes `files` into a fresh temp directory and tracks the original content of every
 * path, so `diff()` returns exactly the files whose content changed (`before: null` for new files).
 * `apply` replays an earlier patch on top (e.g. the fix retry) while the diff stays against `files`.
 */
export async function materializeRepo({
  files,
  apply = [],
}: {
  files: Record<string, string>;
  apply?: PatchFile[];
}): Promise<Workdir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rerun-workdir-'));
  const before = new Map<string, string>();
  const current = new Map<string, string>();
  const rationales = new Map<string, string>();

  async function put(file: string, content: string) {
    current.set(file, content);
    const abs = path.join(dir, file);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }

  for (const [file, content] of Object.entries(files)) {
    const rel = normalizeRepoPath(file);
    before.set(rel, content);
    await put(rel, content);
  }

  const workdir: Workdir = {
    dir,
    read: (file) => current.get(normalizeRepoPath(file)),
    async write(file, content, rationale) {
      const rel = normalizeRepoPath(file);
      await put(rel, content);
      if (rationale !== undefined) rationales.set(rel, rationale);
    },
    list: () => [...current.keys()].sort(),
    diff() {
      const out: PatchFile[] = [];
      for (const file of [...current.keys()].sort()) {
        const after = current.get(file) as string;
        const original = before.has(file) ? (before.get(file) as string) : null;
        if (original === after) continue;
        out.push({ path: file, before: original, after, rationale: rationales.get(file) ?? '' });
      }
      return out;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };

  for (const file of apply) await workdir.write(file.path, file.after, file.rationale);
  return workdir;
}

/** The repo tree after a patch: what the verifier and the PR commit need. */
export function applyPatch(
  files: Record<string, string>,
  patch: Pick<Patch, 'files'>,
): Record<string, string> {
  const out = { ...files };
  for (const file of patch.files) out[normalizeRepoPath(file.path)] = file.after;
  return out;
}
