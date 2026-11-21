import { createHash } from 'node:crypto';
import type { PatchFile, PullRequest } from '../shared/types';
import { DEMO_BASELINE_FILES } from './demoBaseline';
import {
  isAgentVisible,
  parseRepo,
  ProtectedBranchError,
  type GitHubClient,
  type MergeResult,
  type OpenPullRequestInput,
  type RepoSnapshot,
} from './types';

export interface FakePullRequest extends PullRequest {
  title: string;
  body: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
  comments: string[];
  mergeSha?: string;
}

export interface FakeGitHubOptions {
  repo?: string;
  baseBranch?: string;
  /** Initial contents of the base branch (default: the rerun-fixtures baseline). */
  files?: Record<string, string>;
}

/** In-memory GitHub for demo mode and tests: same interface and guards as `GitHubRestClient`. */
export class FakeGitHub implements GitHubClient {
  readonly name = 'fake' as const;
  readonly repo: { owner: string; name: string; baseBranch: string };
  readonly commits = new Map<string, { files: Record<string, string>; parent?: string; message: string }>();
  readonly branches = new Map<string, string>();
  readonly pulls = new Map<number, FakePullRequest>();
  /** Commit each branch was created from, so squash merges apply only that branch's changes. */
  private readonly branchBases = new Map<string, string>();
  private nextNumber = 1;
  private nextCommentId = 1;

  constructor(opts: FakeGitHubOptions = {}) {
    this.repo = {
      ...parseRepo(opts.repo ?? 'tayden-b/rerun-fixtures'),
      baseBranch: opts.baseBranch ?? 'main',
    };
    const sha = this.addCommit({ ...(opts.files ?? DEMO_BASELINE_FILES) }, 'baseline');
    this.branches.set(this.repo.baseBranch, sha);
  }

  private addCommit(files: Record<string, string>, message: string, parent?: string): string {
    const sha = createHash('sha1')
      .update(JSON.stringify({ files, message, parent, n: this.commits.size }))
      .digest('hex');
    this.commits.set(sha, { files, parent, message });
    return sha;
  }

  private resolve(ref: string): string {
    const sha = this.branches.get(ref) ?? (this.commits.has(ref) ? ref : undefined);
    if (!sha) throw new Error(`Unknown ref: ${ref}`);
    return sha;
  }

  private guard(branch: string): void {
    if (branch === this.repo.baseBranch || branch === 'main' || branch === 'master') {
      throw new ProtectedBranchError(branch);
    }
  }

  private pull(number: number): FakePullRequest {
    const pr = this.pulls.get(number);
    if (!pr) throw new Error(`Unknown pull request #${number}`);
    return pr;
  }

  /** All files at a ref, including the ones hidden from agents. */
  filesAt(ref: string): Record<string, string> {
    return { ...this.commits.get(this.resolve(ref))!.files };
  }

  async getRepoSnapshot(ref: string): Promise<RepoSnapshot> {
    const headSha = this.resolve(ref);
    const files = Object.fromEntries(
      Object.entries(this.filesAt(headSha)).filter(([p]) => isAgentVisible(p)),
    );
    return { headSha, files };
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    this.guard(name);
    if (this.branches.has(name)) throw new Error(`Reference already exists: refs/heads/${name}`);
    const sha = this.resolve(fromSha);
    this.branches.set(name, sha);
    this.branchBases.set(name, sha);
  }

  async commitFiles(branch: string, files: PatchFile[], message: string): Promise<{ sha: string }> {
    this.guard(branch);
    if (files.length === 0) throw new Error('commitFiles needs at least one file');
    const parent = this.resolve(branch);
    const next = this.filesAt(parent);
    for (const f of files) next[f.path] = f.after;
    const sha = this.addCommit(next, message, parent);
    this.branches.set(branch, sha);
    return { sha };
  }

  async openPullRequest(input: OpenPullRequestInput): Promise<PullRequest> {
    this.guard(input.branch);
    this.resolve(input.branch);
    const number = this.nextNumber++;
    const pr: FakePullRequest = {
      number,
      url: `https://github.com/${this.repo.owner}/${this.repo.name}/pull/${number}`,
      branch: input.branch,
      draft: input.draft,
      title: input.title,
      body: input.body,
      base: input.base ?? this.repo.baseBranch,
      state: 'open',
      comments: [],
    };
    this.pulls.set(number, pr);
    return { number: pr.number, url: pr.url, branch: pr.branch, draft: pr.draft };
  }

  async mergePullRequest(
    number: number,
    opts: { method?: 'squash' | 'merge' | 'rebase' } = {},
  ): Promise<MergeResult> {
    void opts;
    const pr = this.pull(number);
    if (pr.state !== 'open') throw new Error(`Pull request #${number} is ${pr.state}`);
    if (pr.draft) throw new Error(`Pull request #${number} is a draft and cannot be merged`);
    const base = this.resolve(pr.base);
    const head = this.filesAt(pr.branch);
    const forkPoint = this.commits.get(this.branchBases.get(pr.branch) ?? base)!.files;
    const merged = this.filesAt(base);
    for (const [path, content] of Object.entries(head))
      if (forkPoint[path] !== content) merged[path] = content;
    const sha = this.addCommit(merged, `${pr.title} (#${number})`, base);
    this.branches.set(pr.base, sha);
    pr.state = 'merged';
    pr.mergeSha = sha;
    return { merged: true, sha };
  }

  async commentOnPullRequest(number: number, body: string): Promise<{ id: number; url: string }> {
    const pr = this.pull(number);
    pr.comments.push(body);
    const id = this.nextCommentId++;
    return { id, url: `${pr.url}#issuecomment-${id}` };
  }

  async closePullRequest(number: number): Promise<void> {
    const pr = this.pull(number);
    if (pr.state === 'open') pr.state = 'closed';
  }

  async deleteBranch(name: string): Promise<void> {
    this.guard(name);
    if (!this.branches.delete(name)) throw new Error(`Reference does not exist: refs/heads/${name}`);
    this.branchBases.delete(name);
  }
}
