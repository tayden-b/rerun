import { requireLive, type Config } from '../config';
import { GitHubRestClient } from './client';
import { FakeGitHub, type FakeGitHubOptions } from './fake';
import type { GitHubClient } from './types';

export { GitHubRestClient } from './client';
export { FakeGitHub } from './fake';
export { renderPrBody } from './prBody';
export * from './types';

export function createGitHub(config: Config, opts: { fake?: FakeGitHubOptions } = {}): GitHubClient {
  if (config.mode === 'demo') return new FakeGitHub({ repo: config.fixturesRepo, ...opts.fake });
  const live = requireLive(['github'], config);
  return new GitHubRestClient({ token: live.githubToken!, repo: live.fixturesRepo });
}
