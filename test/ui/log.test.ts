import { describe, expect, it } from 'vitest';
import { readableLog } from '@/lib/ui/log';

describe('readableLog', () => {
  it('uses the first line as the heading for plain text', () => {
    const log = readableLog('Error: No value for required variable\n\non variables.tf line 1:');
    expect(log.heading).toBe('No value for required variable');
    expect(log.lines).toEqual(['', 'on variables.tf line 1:']);
  });

  it('reads Terraform JSON log lines as their messages', () => {
    const excerpt = [
      JSON.stringify({ '@level': 'info', '@message': 'terraform_data.a: Creating...' }),
      JSON.stringify({
        '@level': 'error',
        '@message': 'Error: local-exec provisioner error',
        diagnostic: {
          summary: 'local-exec provisioner error',
          detail: 'exit status 1\n',
          address: 'terraform_data.a',
          range: { filename: 'main.tf', start: { line: 90 } },
        },
      }),
      'Operation failed: failed running terraform apply (exit 1)',
    ].join('\n');
    const log = readableLog(excerpt);
    expect(log.heading).toBe('local-exec provisioner error');
    expect(log.lines).toEqual([
      'terraform_data.a: Creating...',
      'Error: local-exec provisioner error',
      '  on terraform_data.a, main.tf line 90',
      '  exit status 1',
      'Operation failed: failed running terraform apply (exit 1)',
    ]);
  });

  it('keeps lines that are not JSON log records', () => {
    expect(readableLog('{not json}').heading).toBe('{not json}');
  });
});
