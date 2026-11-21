interface RedactionRule {
  label: string;
  pattern: RegExp;
  replace?: (match: string, label: string) => string;
}

const RULES: RedactionRule[] = [
  {
    label: 'bearer',
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (match) => `${match.split(/\s+/)[0]} [REDACTED:bearer]`,
  },
  { label: 'tfe_token', pattern: /\b[A-Za-z0-9]{14}\.atlasv1\.[A-Za-z0-9_-]{60,}/g },
  { label: 'github_pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{80,}/g },
  { label: 'github_token', pattern: /\bgh[pous]_[A-Za-z0-9]{36,}/g },
  { label: 'anthropic_key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
];

export const REDACTION_PATTERNS: readonly RegExp[] = RULES.map((r) => r.pattern);

export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, (match) =>
      rule.replace ? rule.replace(match, rule.label) : `[REDACTED:${rule.label}]`,
    );
  }
  return out;
}
