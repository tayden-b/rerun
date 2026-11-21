import { describe, expect, it } from 'vitest';
import { INCIDENT_STATUSES, STATUS_META, TONE_CLASSES, statusMeta } from '@/lib/ui/status';
import type { IncidentStatus } from '@/src/shared/types';

// SPEC §11, listed independently so a new status without a colour fails here.
const SPEC_STATUSES: IncidentStatus[] = [
  'collecting',
  'triaging',
  'diagnosing',
  'fixing',
  'verifying',
  'proposing',
  'awaiting_approval',
  'merged',
  'confirming',
  'resolved',
  'needs_human',
  'failed',
];

describe('status pill mapping', () => {
  it('covers every IncidentStatus', () => {
    expect([...INCIDENT_STATUSES].sort()).toEqual([...SPEC_STATUSES].sort());
  });

  it.each(SPEC_STATUSES)('%s has a label and a colour', (status) => {
    const meta = STATUS_META[status];
    expect(meta.label).toMatch(/^[A-Z]/);
    expect(TONE_CLASSES[meta.tone].dot).toMatch(/^bg-/);
    expect(TONE_CLASSES[meta.tone].text).toMatch(/^text-/);
  });

  it('gives terminal states distinct colours', () => {
    const tones = new Set(
      ['resolved', 'failed', 'needs_human', 'awaiting_approval'].map((s) => statusMeta(s).tone),
    );
    expect(tones.size).toBe(4);
  });

  it('falls back to neutral for unknown values', () => {
    expect(statusMeta('weird')).toEqual({ label: 'weird', tone: 'neutral' });
  });
});
