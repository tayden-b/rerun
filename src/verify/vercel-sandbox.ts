import type { Verifier, VerifyResult } from '../shared/types';

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/** Placeholder for the Vercel Sandbox verifier (SPEC §1 scope cut). */
export class VercelSandboxVerifier implements Verifier {
  readonly name = 'vercel-sandbox' as const;

  async verify(workdir: string): Promise<VerifyResult> {
    void workdir;
    throw new NotImplementedError(
      'Vercel Sandbox verifier lands after the Dec 2026 fair-use window; see docs/HANDOFF.md',
    );
  }
}
