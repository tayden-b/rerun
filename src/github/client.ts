import { Octokit } from '@octokit/rest';
import type { PatchFile, PullRequest } from '../shared/types';
import {
  isAgentVisible,
  isText,
  parseRepo,
  ProtectedBranchError,
  type GitHubClient,
  type MergeResult,
  type OpenPullRequestInput,
  type RepoSnapshot,
} from './types';

export interface GitHubRestClientOptions {
  token: string;
  /** `owner/name`, e.g. `tayden-b/rerun-fixtures`. */
  repo: string;
  baseBranch?: string;
  /** Files larger than this are left out of snapshots. */
  maxFileBytes?: number;
  octokit?: Octokit;
}

/** GitHub REST client for the fixtures repo (git data API for commits, so no working tree is needed). */
export class GitHubRestClient implements GitHubClient {
  readonly name = 'github' as const;
  readonly repo: { owner: string; name: string; baseBranch: string };
  private readonly octokit: Octokit;
  private readonly maxFileBytes: number;

  constructor(opts: GitHubRestClientOptions) {
    this.repo = { ...parseRepo(opts.repo), baseBranch: opts.baseBranch ?? 'main' };
    this.octokit = opts.octokit ?? new Octokit({ auth: opts.token, userAgent: 'rerun' });
    this.maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  }

  private get r() {
    return { owner: this.repo.owner, repo: this.repo.name };
  }

  private guard(branch: string): void {
    if (branch === this.repo.baseBranch || branch === 'main' || branch === 'master') {
      throw new ProtectedBranchError(branch);
    }
  }

  async getRepoSnapshot(ref: string): Promise<RepoSnapshot> {
    const { data: commit } = await this.octokit.repos.getCommit({ ...this.r, ref });
    const { data: tree } = await this.octokit.git.getTree({
      ...this.r,
      tree_sha: commit.commit.tree.sha,
      recursive: 'true',
    });
    if (tree.truncated) throw new Error(`Tree for ${ref} is too large for a recursive listing`);
    const blobs = tree.tree.filter(
      (e): e is typeof e & { path: string; sha: string } =>
        e.type === 'blob' &&
        typeof e.path === 'string' &&
        typeof e.sha === 'string' &&
        isAgentVisible(e.path) &&
        (e.size ?? 0) <= this.maxFileBytes,
    );
    const entries = await Promise.all(
      blobs.map(async (e) => {
        const { data } = await this.octokit.git.getBlob({ ...this.r, file_sha: e.sha });
        const bytes = Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8');
        return isText(bytes) ? ([e.path, bytes.toString('utf8')] as const) : null;
      }),
    );
    const files: Record<string, string> = {};
    for (const entry of entries) if (entry) files[entry[0]] = entry[1];
    return { headSha: commit.sha, files };
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    this.guard(name);
    await this.octokit.git.createRef({ ...this.r, ref: `refs/heads/${name}`, sha: fromSha });
  }

  async commitFiles(branch: string, files: PatchFile[], message: string): Promise<{ sha: string }> {
    this.guard(branch);
    if (files.length === 0) throw new Error('commitFiles needs at least one file');
    const { data: ref } = await this.octokit.git.getRef({ ...this.r, ref: `heads/${branch}` });
    const { data: parent } = await this.octokit.git.getCommit({ ...this.r, commit_sha: ref.object.sha });
    const tree = await Promise.all(
      files.map(async (f) => {
        const { data: blob } = await this.octokit.git.createBlob({
          ...this.r,
          content: f.after,
          encoding: 'utf-8',
        });
        return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blob.sha };
      }),
    );
    const { data: newTree } = await this.octokit.git.createTree({
      ...this.r,
      base_tree: parent.tree.sha,
      tree,
    });
    const { data: commit } = await this.octokit.git.createCommit({
      ...this.r,
      message,
      tree: newTree.sha,
      parents: [parent.sha],
    });
    await this.octokit.git.updateRef({ ...this.r, ref: `heads/${branch}`, sha: commit.sha });
    return { sha: commit.sha };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequest> {
    this.guard(input.branch);
    const { data } = await this.octokit.pulls.create({
      ...this.r,
      head: input.branch,
      base: input.base ?? this.repo.baseBranch,
      title: input.title,
      body: input.body,
      draft: input.draft,
    });
    return {
      number: data.number,
      url: data.html_url,
      branch: input.branch,
      draft: data.draft ?? input.draft,
    };
  }

  async mergePullRequest(
    number: number,
    opts: { method?: 'squash' | 'merge' | 'rebase' } = {},
  ): Promise<MergeResult> {
    const { data } = await this.octokit.pulls.merge({
      ...this.r,
      pull_number: number,
      merge_method: opts.method ?? 'squash',
    });
    return { merged: data.merged, sha: data.sha };
  }

  async commentOnPullRequest(number: number, body: string): Promise<{ id: number; url: string }> {
    const { data } = await this.octokit.issues.createComment({ ...this.r, issue_number: number, body });
    return { id: data.id, url: data.html_url };
  }

  async closePullRequest(number: number): Promise<void> {
    await this.octokit.pulls.update({ ...this.r, pull_number: number, state: 'closed' });
  }

  async deleteBranch(name: string): Promise<void> {
    this.guard(name);
    await this.octokit.git.deleteRef({ ...this.r, ref: `heads/${name}` });
  }
}
