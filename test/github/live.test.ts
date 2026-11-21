import { describe, expect, it } from 'vitest';
import { GitHubRestClient } from '../../src/github/client';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.RERUN_FIXTURES_REPO ?? 'tayden-b/rerun-fixtures';

describe.runIf(Boolean(token))('GitHubRestClient (live: GITHUB_TOKEN)', () => {
  it('snapshot → branch → commit → draft PR → comment → close → delete', { timeout: 120_000 }, async () => {
    const gh = new GitHubRestClient({ token: token!, repo });
    const branch = `rerun/test-${Date.now()}`;
    const snap = await gh.getRepoSnapshot('main');
    expect(snap.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(snap.files['versions.tf']).toContain('cloud');
    expect(Object.keys(snap.files).some((p) => p.startsWith('scenarios/') || p.startsWith('.github/'))).toBe(
      false,
    );

    await gh.createBranch(branch, snap.headSha);
    let prNumber: number | undefined;
    try {
      const readme = snap.files['README.md'] ?? '';
      const commit = await gh.commitFiles(
        branch,
        [
          {
            path: 'README.md',
            before: readme,
            after: `${readme}\n<!-- rerun live test ${branch} -->\n`,
            rationale: 'test',
          },
        ],
        'test: rerun GitHub client live check',
      );
      expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
      const pr = await gh.openPullRequest({
        branch,
        title: 'Rerun live client test (closing automatically)',
        body: 'Opened and closed by the Rerun GitHub client live test.',
        draft: true,
      });
      prNumber = pr.number;
      console.log(`live GitHub test PR #${pr.number}: ${pr.url}`);
      expect(pr.draft).toBe(true);
      const comment = await gh.commentOnPullRequest(pr.number, 'Live test comment; this PR closes itself.');
      expect(comment.url).toContain(`/pull/${pr.number}`);
    } finally {
      if (prNumber !== undefined) await gh.closePullRequest(prNumber);
      await gh.deleteBranch(branch);
    }
  });
});
