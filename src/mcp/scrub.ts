import { redact } from '../shared/redact';

const RULES: [RegExp, string][] = [
  // Pre-signed archivist log URLs grant read access to the log without a token.
  [
    /https:\/\/archivist\.terraform\.io\/v1\/object\/[A-Za-z0-9+/=_-]+/g,
    'https://archivist.terraform.io/v1/object/[REDACTED:signed_url]',
  ],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'recorder@example.com'],
];

/** `redact()` plus fixture-only rules (signed URLs, email addresses). Applied to every recorded tool output. */
export function scrubForFixture(text: string): string {
  let out = redact(text);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** whoami is identity data; fixtures keep its shape but not the account. */
export function scrubWhoami(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), username: 'rerun-recorder', email: 'recorder@example.com' };
}
