import { Badge } from '@/components/ui/badge';
import { failureClassLabel } from '@/lib/ui/status';

export function FailureClassBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge variant="outline" className="text-muted-foreground rounded-md font-mono font-normal">
      {failureClassLabel(value)}
    </Badge>
  );
}
