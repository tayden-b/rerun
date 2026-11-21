import { describe, expect, it } from 'vitest';
import { formatDuration, relativeTime } from '@/lib/ui/time';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('relativeTime', () => {
  it.each([
    [0, 'just now'],
    [5_000, 'just now'],
    [42_000, '42s ago'],
    [5 * 60_000, '5m ago'],
    [59 * 60_000, '59m ago'],
    [3 * 3_600_000, '3h ago'],
    [6 * 86_400_000, '6d ago'],
  ])('%i ms ago is %s', (ms, expected) => {
    expect(relativeTime(ago(ms), NOW)).toBe(expected);
  });

  it('uses a date beyond 30 days', () => {
    expect(relativeTime('2026-09-03T08:00:00.000Z', NOW)).toBe('Sep 3');
  });

  it('treats future timestamps as now and rejects garbage', () => {
    expect(relativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
    expect(relativeTime('not a date', NOW)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [820, '820ms'],
    [4_200, '4.2s'],
    [18_400, '18s'],
    [192_000, '3m 12s'],
    [3_840_000, '1h 4m'],
  ])('%i ms is %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('renders missing values as a dash', () => {
    expect(formatDuration(null)).toBe('—');
  });
});
