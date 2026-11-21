import { redact } from '../shared/redact';

/** A decision request that failed or produced an answer Rerun cannot use. Messages are redacted. */
export class DecisionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(redact(message));
    this.name = 'DecisionError';
  }
}
