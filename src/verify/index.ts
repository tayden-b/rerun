import { requireLive, type Config } from '../config';
import type { Verifier } from '../shared/types';
import { DockerVerifier, type DockerVerifierOptions } from './docker';
import { FakeVerifier } from './fake';
import { VercelSandboxVerifier } from './vercel-sandbox';

export { DockerVerifier, TERRAFORM_IMAGE, planSummary, failureSummary } from './docker';
export { FakeVerifier, GENERIC_PASS } from './fake';
export { NotImplementedError, VercelSandboxVerifier } from './vercel-sandbox';

export interface CreateVerifierOptions {
  /** Override the mode default (demo → `fake`, live → `docker`). */
  kind?: Verifier['name'];
  /** Demo scenario whose `verify.json` the fake replays. */
  scenario?: string;
  docker?: DockerVerifierOptions;
}

export function createVerifier(config: Config, opts: CreateVerifierOptions = {}): Verifier {
  const kind = opts.kind ?? (config.mode === 'demo' ? 'fake' : 'docker');
  switch (kind) {
    case 'fake':
      return new FakeVerifier({ scenario: opts.scenario });
    case 'vercel-sandbox':
      return new VercelSandboxVerifier();
    case 'docker':
      requireLive(['tfe'], config);
      return new DockerVerifier(opts.docker);
  }
}
