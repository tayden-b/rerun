'use client';

import { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { relativeTime } from '@/lib/ui/time';

export function RelativeTime({ iso, now }: { iso: string; now: number }) {
  const [current, setCurrent] = useState(now);
  useEffect(() => {
    const timer = setInterval(() => setCurrent(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time dateTime={iso} className="text-muted-foreground text-xs tabular-nums">
          {relativeTime(iso, current)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{new Date(iso).toUTCString()}</TooltipContent>
    </Tooltip>
  );
}
