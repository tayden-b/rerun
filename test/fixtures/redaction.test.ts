import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REDACTION_PATTERNS } from '../../src/shared/redact';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const TOKEN_MARKERS = ['atlasv1', 'ghp_', 'github_pat_', 'sk-ant-'];

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
