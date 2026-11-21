import type { FailureClass, Route } from '../src/shared/types';
import { FAILURE_CLASSES, type Calibration, type PerClass } from './schema';

export interface Outcome {
  expected: { failureClass: FailureClass; route: Route };
  predicted: { failureClass: FailureClass; route: Route };
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function accuracy(outcomes: Outcome[]): {
  classAccuracy: number | null;
  routeAccuracy: number | null;
} {
  return {
    classAccuracy: mean(outcomes.map((o) => (o.expected.failureClass === o.predicted.failureClass ? 1 : 0))),
    routeAccuracy: mean(outcomes.map((o) => (o.expected.route === o.predicted.route ? 1 : 0))),
  };
}

/** Precision/recall for every class that is expected or predicted at least once (enum order). */
export function perClass(outcomes: Outcome[]): PerClass[] {
  return FAILURE_CLASSES.flatMap((cls) => {
    const support = outcomes.filter((o) => o.expected.failureClass === cls).length;
    const predicted = outcomes.filter((o) => o.predicted.failureClass === cls).length;
    if (support === 0 && predicted === 0) return [];
    const tp = outcomes.filter(
      (o) => o.expected.failureClass === cls && o.predicted.failureClass === cls,
    ).length;
    return [
      {
        failureClass: cls,
        support,
        predicted,
        precision: predicted ? tp / predicted : null,
        recall: support ? tp / support : null,
      },
    ];
  });
}

/** Ten 0.1-wide bins of predicted probability `p` vs. binary outcome `y`; ECE = Σ (n_b / N)·|mean p_b − mean y_b|. */
export function calibration(points: { p: number; y: 0 | 1 }[]): Calibration {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    ps: [] as number[],
    ys: [] as number[],
  }));
  for (const { p, y } of points) {
    const bin = bins[Math.min(9, Math.max(0, Math.floor(p * 10)))];
    bin.ps.push(p);
    bin.ys.push(y);
  }
  const n = points.length;
  const ece = n
    ? bins.reduce(
        (sum, b) => (b.ps.length ? sum + (b.ps.length / n) * Math.abs(mean(b.ps)! - mean(b.ys)!) : sum),
        0,
      )
    : null;
  return {
    ece,
    n,
    bins: bins.map((b) => ({
      lo: b.lo,
      hi: b.hi,
      count: b.ps.length,
      meanPredicted: mean(b.ps),
      observedRate: mean(b.ys),
    })),
  };
}

export interface Verdict {
  failureClass: FailureClass;
  route: Route;
}

/** Share of perturbed runs whose class or route differs from the unperturbed run. */
export function flipRate(baseline: Verdict, runs: Verdict[]): { flips: number; flipRate: number | null } {
  const flips = runs.filter(
    (r) => r.failureClass !== baseline.failureClass || r.route !== baseline.route,
  ).length;
  return { flips, flipRate: runs.length ? flips / runs.length : null };
}

export { mean };
