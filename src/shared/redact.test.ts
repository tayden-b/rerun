import { describe, expect, it } from 'vitest';
import { redact } from './redact';

// Synthetic tokens assembled at runtime so no token-shaped literal sits in the repo.
const rep = (ch: string, n: number) => ch.repeat(n);
const TFE = `${rep('a', 14)}.atlasv1.${rep('B', 64)}`;
const GHP = `ghp_${rep('x', 36)}`;
const GHS = `ghs_${rep('Y', 40)}`;
const FINE = `github_pat_${rep('z', 82)}`;
const ANT = `sk-ant-api03-${rep('q', 40)}`;

describe('redact', () => {
  it.each([
    ['HCP Terraform token', `token = "${TFE}"`, 'tfe_token'],
    ['classic GitHub PAT', `GITHUB_TOKEN=${GHP}`, 'github_token'],
    ['GitHub server token', `using ${GHS} now`, 'github_token'],
    ['fine-grained GitHub PAT', `pat: ${FINE}`, 'github_pat'],
    ['Anthropic key', `x-api-key: ${ANT}`, 'anthropic_key'],
  ])('masks a %s', (_name, input, label) => {
    const out = redact(input);
    expect(out).toContain(`[REDACTED:${label}]`);
    for (const secret of [TFE, GHP, GHS, FINE, ANT]) expect(out).not.toContain(secret);
  });

  it('masks bearer authorization headers', () => {
    const out = redact('Authorization: Bearer abc.def-ghi_jkl/mno+pqr=');
    expect(out).toBe('Authorization: Bearer [REDACTED:bearer]');
  });

  it('masks every token in a multi-line blob', () => {
    const out = redact([TFE, GHP, FINE, ANT].join('\n'));
    expect(out.split('\n')).toEqual([
      '[REDACTED:tfe_token]',
      '[REDACTED:github_token]',
      '[REDACTED:github_pat]',
      '[REDACTED:anthropic_key]',
    ]);
  });

  it('leaves normal text untouched', () => {
    const text = [
      'Error: local-exec provisioner error',
      '  with terraform_data.bootstrap, on main.tf line 42',
      'run-AbC123xyz ws-9f8e7d6c sk-ant (too short) ghp_short Bearer',
      'atlasv1 is mentioned here without a token',
    ].join('\n');
    expect(redact(text)).toBe(text);
  });
});
