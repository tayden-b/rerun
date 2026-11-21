import { cn } from 'cn';
import { Skeleton } from '@/components/ui/skeleton';

export function Section({
  title,
  meta,
  children,
  className,
  ...props
}: { title: string; meta?: React.ReactNode } & React.ComponentProps<'section'>) {
  return (
    <section className={cn('grid gap-3', className)} {...props}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {meta && <div className="text-muted-foreground text-xs">{meta}</div>}
      </div>
      {children}
    </section>
  );
}

export function SectionSkeleton({ caption, lines = 3 }: { caption: string; lines?: number }) {
  return (
    <div className="bg-card grid gap-2.5 rounded-lg border p-4" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${90 - i * 18}%` }} />
      ))}
      <p className="text-muted-foreground pt-1 text-xs">{caption}</p>
    </div>
  );
}
