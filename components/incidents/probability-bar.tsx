import { cn } from 'cn';
import { clamp01, formatPercent } from '@/lib/ui/format';

export interface ProbabilityBarProps {
  label: string;
  value: number;
  detail?: string;
  /** Muted bars for values where high is bad, so the accent only marks the decisive signal. */
  emphasis?: 'brand' | 'muted';
}

export function ProbabilityBar({ label, value, detail, emphasis = 'brand' }: ProbabilityBarProps) {
  const clamped = clamp01(value);
  return (
    <div data-testid="probability-bar" className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground font-mono tabular-nums">{formatPercent(clamped)}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
        className="bg-muted h-1.5 overflow-hidden rounded-full"
      >
        <div
          data-slot="probability-bar-fill"
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            emphasis === 'brand' ? 'bg-brand' : 'bg-muted-foreground/60',
          )}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      {detail && <p className="text-muted-foreground truncate text-xs">{detail}</p>}
    </div>
  );
}
