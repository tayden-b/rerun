import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import {
  createGitHub,
  FakeGitHub,
  GitHubRestClient,
  isAgentVisible,
  ProtectedBranchError,
} from '../../src/github';

const seed = {
  'main.tf': 'resource "random_pet" "a" {}\n',
  'README.md': '# fixtures\n',
  'scenarios/x/break.patch': 'diff',
  'baseline/main.tf': 'old',
  '.github/workflows/terraform.yml': 'on: push',
};

describe('FakeGitHub', () => {
  it('hides scenarios, baseline and .github from the snapshot but keeps them in commits', async () => {
    const gh = new FakeGitHub({ files: seed });
    const snap = await gh.getRepoSnapshot('main');
    expect(Object.keys(snap.files).sort()).toEqual(['README.md', 'main.tf']);
    await gh.createBranch('rerun/fix-run-1', snap.headSha);
    await gh.commitFiles(
      'rerun/fix-run-1',
      [{ path: 'main.tf', before: seed['main.tf'], after: 'fixed\n', rationale: 'fix' }],
      'fix',
    );
    const all = gh.filesAt('rerun/fix-run-1');
    expect(all['main.tf']).toBe('fixed\n');
    expect(all['scenarios/x/break.patch']).toBe('diff');
    expect(gh.filesAt('main')['main.tf']).toBe(seed['main.tf']);
  });

  it('runs branch → commit → PR → comment → merge and updates main', async () => {
    const gh = new FakeGitHub({ files: seed });
    const { headSha } = await gh.getRepoSnapshot('main');
    await gh.createBranch('rerun/fix-run-2', headSha);
    const commit = await gh.commitFiles(
      'rerun/fix-run-2',
      [{ path: 'new.tf', before: null, after: 'x\n', rationale: 'add' }],
      'add new.tf',
    );
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    const pr = await gh.openPullRequest({ branch: 'rerun/fix-run-2', title: 'Fix', body: 'b', draft: false });
    expect(pr).toEqual({
      number: 1,
      url: 'https://github.com/tayden-b/rerun-fixtures/pull/1',
      branch: 'rerun/fix-run-2',
      draft: false,
    });
    const comment = await gh.commentOnPullRequest(pr.number, 'hello');
    expect(comment.url).toContain('/pull/1#issuecomment-');
    const merged = await gh.mergePullRequest(pr.number, { method: 'squash' });
    expect(merged.merged).toBe(true);
    expect((await gh.getRepoSnapshot('main')).headSha).toBe(merged.sha);
    expect(gh.filesAt('main')['new.tf']).toBe('x\n');
    expect(gh.pulls.get(1)).toMatchObject({ state: 'merged', comments: ['hello'] });
  });

  it('refuses to merge drafts, and close + delete leave no branch behind', async () => {
    const gh = new FakeGitHub({ files: seed });
    const { headSha } = await gh.getRepoSnapshot('main');
    await gh.createBranch('rerun/fix-run-3', headSha);
    const pr = await gh.openPullRequest({ branch: 'rerun/fix-run-3', title: 'Fix', body: 'b', draft: true });
    await expect(gh.mergePullRequest(pr.number)).rejects.toThrow(/draft/);
    await gh.closePullRequest(pr.number);
    await gh.deleteBranch('rerun/fix-run-3');
    expect(gh.pulls.get(pr.number)?.state).toBe('closed');
    expect(gh.branches.has('rerun/fix-run-3')).toBe(false);
  });

  it('never writes to main', async () => {
    const gh = new FakeGitHub({ files: seed });
    const file = { path: 'main.tf', before: null, after: 'x', rationale: 'r' };
    await expect(gh.commitFiles('main', [file], 'm')).rejects.toBeInstanceOf(ProtectedBranchError);
    await expect(gh.createBranch('main', 'x')).rejects.toBeInstanceOf(ProtectedBranchError);
    await expect(gh.deleteBranch('main')).rejects.toBeInstanceOf(ProtectedBranchError);
  });

  it('seeds the rerun-fixtures baseline by default', async () => {
    const snap = await new FakeGitHub().getRepoSnapshot('main');
    expect(snap.files['versions.tf']).toContain('cloud {');
    expect(Object.keys(snap.files)).toContain('modules/naming/main.tf');
  });
});

describe('createGitHub', () => {
  it('uses the fake in demo mode and the REST client in live mode', () => {
    expect(createGitHub(loadConfig({ RERUN_MODE: 'demo' }))).toBeInstanceOf(FakeGitHub);
    expect(() => createGitHub(loadConfig({ RERUN_MODE: 'live' }))).toThrow(/GITHUB_TOKEN/);
    const live = createGitHub(
      loadConfig({ RERUN_MODE: 'live', GITHUB_TOKEN: 'x', RERUN_FIXTURES_REPO: 'a/b' }),
    );
    expect(live).toBeInstanceOf(GitHubRestClient);
    expect(live.repo).toEqual({ owner: 'a', name: 'b', baseBranch: 'main' });
  });

  it('classifies agent-visible paths', () => {
    expect(isAgentVisible('main.tf')).toBe(true);
    expect(isAgentVisible('modules/naming/main.tf')).toBe(true);
    expect(isAgentVisible('scenarios/a/README.md')).toBe(false);
    expect(isAgentVisible('baseline/main.tf')).toBe(false);
    expect(isAgentVisible('.github/workflows/terraform.yml')).toBe(false);
  });
});
