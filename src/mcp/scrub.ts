import { redact } from '../shared/redact';

const RULES: [RegExp, string][] = [
  // Pre-signed archivist log URLs grant read access to the log without a token.
  [
    /https:\/\/archivist\.terraform\.io\/v1\/object\/[A-Za-z0-9+/=_-]+/g,
    'https://archivist.terraform.io/v1/object/[REDACTED:signed_url]',
  ],
  // Plan JSON and state carry provider-generated private keys (e.g. `tls_private_key`) in clear text.
  [/-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, '[REDACTED:private_key]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'recorder@example.com'],
];

/** `redact()` plus signed log URLs, PEM private keys and email addresses. Applied to recorded fixtures and to emitted trace payloads. */
export function scrubToolOutput(text: string): string {
  let out = redact(text);
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}

/** whoami is identity data; fixtures keep its shape but not the account. */
export function scrubWhoami(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  return { ...(data as Record<string, unknown>), username: 'rerun-recorder', email: 'recorder@example.com' };
}
