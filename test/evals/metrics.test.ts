import { describe, expect, it } from 'vitest';
import { accuracy, calibration, flipRate, perClass, type Outcome } from '../../evals/metrics';

const o = (e: string, p: string, er = 'autoPr', pr = 'autoPr') =>
  ({ expected: { failureClass: e, route: er }, predicted: { failureClass: p, route: pr } }) as Outcome;

describe('metrics', () => {
  const outcomes = [
    o('apply_runtime', 'apply_runtime'),
    o('apply_runtime', 'config_syntax', 'autoPr', 'draftPr'),
    o('config_syntax', 'config_syntax'),
    o('config_reference', 'config_syntax', 'draftPr', 'draftPr'),
  ];

  it('computes class and route accuracy', () => {
    expect(accuracy(outcomes)).toEqual({ classAccuracy: 0.5, routeAccuracy: 0.75 });
    expect(accuracy([])).toEqual({ classAccuracy: null, routeAccuracy: null });
  });

  it('computes per-class precision and recall', () => {
    expect(perClass(outcomes)).toEqual([
      { failureClass: 'config_syntax', support: 1, predicted: 3, precision: 1 / 3, recall: 1 },
      { failureClass: 'config_reference', support: 1, predicted: 0, precision: null, recall: 0 },
      { failureClass: 'apply_runtime', support: 2, predicted: 1, precision: 1, recall: 0.5 },
    ]);
  });

  it('computes ECE on a known distribution', () => {
    // Bin 0.9–1.0: p=0.95 ×4, 3 positives → |0.95 − 0.75| = 0.2, weight 0.5.
    // Bin 0.1–0.2: p=0.15 ×4, 0 positives → |0.15 − 0| = 0.15, weight 0.5.
    const points = [
      ...[1, 1, 1, 0].map((y) => ({ p: 0.95, y: y as 0 | 1 })),
      ...[0, 0, 0, 0].map((y) => ({ p: 0.15, y: y as 0 | 1 })),
    ];
    const c = calibration(points);
    expect(c.n).toBe(8);
    expect(c.ece).toBeCloseTo(0.175, 10);
    expect(c.bins).toHaveLength(10);
    expect(c.bins[9]).toMatchObject({ count: 4, observedRate: 0.75 });
    expect(c.bins[9].meanPredicted).toBeCloseTo(0.95, 10);
    expect(c.bins[1]).toMatchObject({ count: 4, observedRate: 0 });
    expect(c.bins[5]).toEqual({ lo: 0.5, hi: 0.6, count: 0, meanPredicted: null, observedRate: null });
  });

  it('puts p = 1 in the last bin and is 0 when perfectly calibrated', () => {
    const c = calibration([
      { p: 1, y: 1 },
      { p: 0, y: 0 },
    ]);
    expect(c.bins[9].count).toBe(1);
    expect(c.bins[0].count).toBe(1);
    expect(c.ece).toBe(0);
    expect(calibration([]).ece).toBeNull();
  });

  it('computes flip rate against the unperturbed verdict', () => {
    const base = { failureClass: 'apply_runtime', route: 'autoPr' } as const;
    expect(
      flipRate(base, [
        base,
        { failureClass: 'config_syntax', route: 'autoPr' },
        { failureClass: 'apply_runtime', route: 'draftPr' },
        base,
      ]),
    ).toEqual({ flips: 2, flipRate: 0.5 });
    expect(flipRate(base, [])).toEqual({ flips: 0, flipRate: null });
  });
});
