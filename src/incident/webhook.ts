import { createHmac, timingSafeEqual } from 'node:crypto';

// HCP Terraform generic notification webhook: `X-TFC-Notification-Signature` is the hex HMAC-SHA512 of
// the raw body keyed by the notification token (TFC_WEBHOOK_SECRET).

export const SIGNATURE_HEADER = 'x-tfc-notification-signature';

export function signBody(body: string, secret: string): string {
  return createHmac('sha512', secret).update(body, 'utf8').digest('hex');
}

export function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signBody(body, secret), 'hex');
  const given = Buffer.from(signature.trim().toLowerCase(), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface TfcNotification {
  payload_version?: number;
  run_id?: string | null;
  workspace_name?: string | null;
  notifications?: { trigger?: string; run_status?: string }[];
}

/** The errored run id when the payload is a `run:errored` notification for `workspace`, else null. */
export function erroredRunFor(payload: TfcNotification, workspace: string): string | null {
  if (!payload.run_id || payload.workspace_name !== workspace) return null;
  const errored = (payload.notifications ?? []).some((n) => n.trigger === 'run:errored');
  return errored ? payload.run_id : null;
}
