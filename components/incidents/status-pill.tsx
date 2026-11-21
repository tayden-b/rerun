import { cn } from 'cn';
import { isInProgress, statusMeta, TONE_CLASSES } from '@/lib/ui/status';

export function StatusPill({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  const tone = TONE_CLASSES[meta.tone];
  return (
    <span
      data-slot="status-pill"
      data-status={status}
      data-tone={meta.tone}
      className={cn(
        'inline-flex items-center gap-2 text-xs font-medium whitespace-nowrap',
        tone.text,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {isInProgress(status) && (
          <span
            className={cn(
              'absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping',
              tone.dot,
            )}
          />
        )}
        <span className={cn('relative inline-flex size-1.5 rounded-full', tone.dot)} />
      </span>
      {meta.label}
    </span>
  );
}
