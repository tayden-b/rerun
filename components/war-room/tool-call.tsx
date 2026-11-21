'use client';

import { CircleXIcon, WrenchIcon } from 'lucide-react';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { JsonBlock } from '@/components/war-room/json-block';
import type { ToolCallView } from '@/lib/ui/incident-view';
import { formatDuration } from '@/lib/ui/time';

export function ToolCall({ call }: { call: ToolCallView }) {
  const pending = call.ok === undefined;
  return (
    <TraceCollapsible data-testid="tool-call">
      <TraceCollapsibleTrigger>
        <TraceLine status={pending ? 'running' : call.ok ? undefined : 'error'}>
          <TraceIcon>{call.ok === false ? <CircleXIcon /> : <WrenchIcon />}</TraceIcon>
          <TraceTitle className="font-mono text-xs">{call.tool}</TraceTitle>
          <TraceDescription className="font-mono text-xs">
            {pending ? 'running' : formatDuration(call.durationMs)}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="grid gap-2">
        <JsonBlock label="Arguments" value={call.args ?? {}} />
        {!pending && <JsonBlock label="Result" value={call.output} />}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
