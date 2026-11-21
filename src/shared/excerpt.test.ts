import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXCERPT_MAX_LINES, extractErrorExcerpt } from './excerpt';

const sampleLog = readFileSync(path.join(__dirname, '__fixtures__/apply-exit-1.log'), 'utf8');

describe('extractErrorExcerpt', () => {
  it('reduces a 400-line Terraform log to at most 120 lines', () => {
    expect(sampleLog.split('\n').length).toBeGreaterThanOrEqual(400);
    const excerpt = extractErrorExcerpt(sampleLog);
    expect(excerpt.split('\n').length).toBeLessThanOrEqual(EXCERPT_MAX_LINES);
  });

  it('keeps the whole Error: block with its context', () => {
    const excerpt = extractErrorExcerpt(sampleLog);
    expect(excerpt).toContain('│ Error: local-exec provisioner error');
    expect(excerpt).toContain('on main.tf line 58, in resource "terraform_data" "bootstrap":');
    expect(excerpt).toContain("Error running command 'echo bootstrapping && exit 1': exit status 1.");
    expect(excerpt).toContain('Operation failed: failed running terraform apply (exit 1)');
  });

  it('drops lines without signal', () => {
    const excerpt = extractErrorExcerpt(sampleLog);
    expect(excerpt).not.toContain('Refreshing state');
    expect(excerpt).not.toContain('will be created');
  });

  it('redacts secrets', () => {
    const log = `${sampleLog}\nError: auth failed with Bearer PLACEHOLDERTOKENVALUE123456\n`;
    const excerpt = extractErrorExcerpt(log);
    expect(excerpt).not.toContain('PLACEHOLDERTOKENVALUE123456');
    expect(excerpt).toContain('Bearer [REDACTED:bearer]');
  });

  it('strips ANSI colour codes', () => {
    expect(extractErrorExcerpt('\u001b[31mError:\u001b[0m boom')).toBe('Error: boom');
  });

  it('falls back to the tail of the log when nothing matches', () => {
    const log = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const excerpt = extractErrorExcerpt(log).split('\n');
    expect(excerpt).toHaveLength(EXCERPT_MAX_LINES);
    expect(excerpt.at(-1)).toBe('line 199');
  });
});
