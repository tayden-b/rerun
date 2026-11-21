import type { PatchFile, PullRequest } from '../shared/types';

export interface RepoSnapshot {
  headSha: string;
  /** Agent-visible text files only (see `isAgentVisible`). */
  files: Record<string, string>;
}

export interface OpenPullRequestInput {
  branch: string;
  base?: string;
  title: string;
  body: string;
  draft: boolean;
}

export interface MergeResult {
  merged: boolean;
  sha: string;
}

export interface GitHubClient {
  readonly name: 'github' | 'fake';
  readonly repo: { owner: string; name: string; baseBranch: string };
  getRepoSnapshot(ref: string): Promise<RepoSnapshot>;
  createBranch(name: string, fromSha: string): Promise<void>;
  /** Commits on top of the branch head; files not in `files` are kept unchanged. Returns the new commit SHA. */
  commitFiles(branch: string, files: PatchFile[], message: string): Promise<{ sha: string }>;
  openPullRequest(input: OpenPullRequestInput): Promise<PullRequest>;
  mergePullRequest(number: number, opts?: { method?: 'squash' | 'merge' | 'rebase' }): Promise<MergeResult>;
  commentOnPullRequest(number: number, body: string): Promise<{ id: number; url: string }>;
  closePullRequest(number: number): Promise<void>;
  deleteBranch(name: string): Promise<void>;
}

export class ProtectedBranchError extends Error {
  constructor(branch: string) {
    super(`Rerun never writes to "${branch}" directly; use a rerun/* branch and a pull request.`);
    this.name = 'ProtectedBranchError';
  }
}

const HIDDEN_PREFIXES = ['scenarios/', 'baseline/', '.github/'];

/** Scenario seeds, the baseline copy and CI config stay in the repo but are hidden from the agents. */
export function isAgentVisible(path: string): boolean {
  return !HIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Text check used to drop binaries from snapshots: no NUL byte and valid UTF-8. */
export function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function parseRepo(fullName: string): { owner: string; name: string } {
  const [owner, name, ...rest] = fullName.split('/');
  if (!owner || !name || rest.length > 0) throw new Error(`Expected "owner/name", got "${fullName}"`);
  return { owner, name };
}
