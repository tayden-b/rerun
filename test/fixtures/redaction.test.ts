import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scrubToolOutput } from '../../src/mcp/scrub';
import { REDACTION_PATTERNS } from '../../src/shared/redact';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const TOKEN_MARKERS = ['atlasv1', 'ghp_', 'github_pat_', 'sk-ant-', 'PRIVATE KEY-----'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(FIXTURES).map((f) => path.relative(process.cwd(), f));

describe('recorded fixtures hold no tokens', () => {
  it('finds the fixture files', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it.each(files)('%s', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const pattern of REDACTION_PATTERNS) {
      expect(text.match(new RegExp(pattern.source, pattern.flags.replace('g', '')))).toBeNull();
    }
    for (const marker of TOKEN_MARKERS) expect(text).not.toContain(marker);
  });
});

describe('scrubToolOutput', () => {
  it('redacts PEM private keys in JSON text but keeps public keys and certificates', () => {
    const key = (label: string) => `-----BEGIN ${label}-----\\nMHcCAQEEIAbc\\n-----END ${label}-----\\n`;
    const text = JSON.stringify({
      private_key_pem: key('EC PRIVATE KEY'),
      private_key_openssh: key('OPENSSH PRIVATE KEY'),
      private_key_pem_pkcs8: key('PRIVATE KEY'),
      public_key_pem: key('PUBLIC KEY'),
      cert_pem: key('CERTIFICATE'),
    });
    const out = JSON.parse(scrubToolOutput(text)) as Record<string, string>;
    expect(out.private_key_pem).toBe('[REDACTED:private_key]\\n');
    expect(out.private_key_openssh).toBe('[REDACTED:private_key]\\n');
    expect(out.private_key_pem_pkcs8).toBe('[REDACTED:private_key]\\n');
    expect(out.public_key_pem).toContain('BEGIN PUBLIC KEY');
    expect(out.cert_pem).toContain('BEGIN CERTIFICATE');
  });
});
