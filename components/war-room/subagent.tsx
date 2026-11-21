'use client';

import { BotIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { Skeleton } from '@/components/ui/skeleton';
import { traceStatus } from '@/components/war-room/step-icon';
import { ToolCall } from '@/components/war-room/tool-call';
import type { SubagentView } from '@/lib/ui/incident-view';
import { formatPercent } from '@/lib/ui/format';
import { formatDuration } from '@/lib/ui/time';

const AGENT_LABEL = { config: 'Config agent', reality: 'Reality agent' } as const;

export function Subagent({ agent }: { agent: SubagentView }) {
  const calls = agent.tools.length;
  return (
    <TraceCollapsible defaultOpen data-testid="subagent-panel" data-agent={agent.agent}>
      <TraceCollapsibleTrigger>
        <TraceLine status={traceStatus(agent.state)}>
          <TraceIcon>
            <BotIcon />
          </TraceIcon>
          <TraceTitle className="text-foreground">{AGENT_LABEL[agent.agent]}</TraceTitle>
          {agent.model && (
            <Badge variant="outline" className="text-muted-foreground rounded-md font-mono font-normal">
              {agent.model}
            </Badge>
          )}
          <TraceDescription className="text-xs">
            {calls} tool {calls === 1 ? 'call' : 'calls'} · {formatDuration(agent.durationMs)}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="grid gap-2.5">
        {agent.task && <p className="text-xs">{agent.task}</p>}
        <Trace className="gap-1.5">
          {agent.tools.map((call) => (
            <ToolCall key={call.id} call={call} />
          ))}
        </Trace>
        {agent.diagnosis ? (
          <div className="bg-card rounded-md border px-3 py-2.5">
            <div className="text-muted-foreground mb-1 flex items-center justify-between text-[11px] tracking-wide uppercase">
              <span>Diagnosis</span>
              <span className="font-mono normal-case">
                {formatPercent(agent.diagnosis.confidence)} confident
              </span>
            </div>
            <p className="text-foreground text-[13px] leading-relaxed">{agent.diagnosis.rootCause}</p>
          </div>
        ) : agent.state === 'running' ? (
          <div className="grid gap-1.5 rounded-md border px-3 py-2.5" aria-busy="true">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
