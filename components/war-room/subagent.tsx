'use client';

import { BotIcon } from 'lucide-react';
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
          <TraceDescription className="text-xs">
            {agent.model && <span className="font-mono">{agent.model} · </span>}
            {calls} tool {calls === 1 ? 'call' : 'calls'} · {formatDuration(agent.durationMs)}
          </TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="grid gap-3">
        {agent.task && <p className="text-sm">{agent.task}</p>}
        <Trace className="gap-2">
          {agent.tools.map((call) => (
            <ToolCall key={call.id} call={call} />
          ))}
        </Trace>
        {agent.diagnosis ? (
          <div className="bg-background rounded-md border px-3 py-3">
            <div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
              <span>Diagnosis</span>
              <span className="font-mono tabular-nums">
                {formatPercent(agent.diagnosis.confidence)} confident
              </span>
            </div>
            <p className="text-foreground text-sm leading-relaxed">{agent.diagnosis.rootCause}</p>
          </div>
        ) : agent.state === 'running' ? (
          <div className="grid gap-2 rounded-md border px-3 py-3" aria-busy="true">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
