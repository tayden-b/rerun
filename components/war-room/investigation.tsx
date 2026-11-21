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
import { StepIcon, traceStatus } from '@/components/war-room/step-icon';
import { Subagent } from '@/components/war-room/subagent';
import { ToolCall } from '@/components/war-room/tool-call';
import type { IncidentView, StepView, ToolCallView } from '@/lib/ui/incident-view';
import { formatPercent } from '@/lib/ui/format';
import { failureClassLabel } from '@/lib/ui/status';
import { formatDuration } from '@/lib/ui/time';

function toolCalls(step: StepView): ToolCallView[] {
  const calls = new Map<string, ToolCallView>();
  for (const event of step.events) {
    if (event.kind !== 'tool_call' && event.kind !== 'tool_result') continue;
    const p = (event.payload ?? {}) as Record<string, unknown>;
    const id = typeof p.toolCallId === 'string' ? p.toolCallId : `${event.title}-${event.seq}`;
    const call = calls.get(id) ?? {
      id,
      tool: typeof p.tool === 'string' ? p.tool : event.title,
      args: undefined,
    };
    if (event.kind === 'tool_call') call.args = p.args;
    else {
      call.output = p.output;
      call.ok = p.ok !== false;
      if (typeof p.durationMs === 'number') call.durationMs = p.durationMs;
    }
    calls.set(id, call);
  }
  return [...calls.values()];
}

function stepSummary(step: StepView, view: IncidentView): string | null {
  switch (step.step) {
    case 'triage':
      return view.triage
        ? `${failureClassLabel(view.triage.failureClass.choice)} · ${formatPercent(view.triage.failureClass.confidence)}`
        : null;
    case 'fix':
      return view.patch
        ? `${view.patch.files.length} ${view.patch.files.length === 1 ? 'file' : 'files'}`
        : null;
    case 'verify':
      return view.verify ? (view.verify.ok ? 'plan passed' : 'plan failed') : null;
    case 'propose':
      return view.pr ? `#${view.pr.number}${view.pr.draft ? ' draft' : ''}` : null;
    default:
      return null;
  }
}

export function Investigation({ view }: { view: IncidentView }) {
  return (
    <Trace data-testid="investigation" className="bg-card gap-3 rounded-lg border p-4">
      {view.steps.map((step) => {
        const summary = stepSummary(step, view);
        const description = [summary, step.durationMs !== null ? formatDuration(step.durationMs) : null]
          .filter(Boolean)
          .join(' · ');
        const line = (
          <TraceLine status={traceStatus(step.state)}>
            <TraceIcon>
              <StepIcon state={step.state} />
            </TraceIcon>
            <TraceTitle className={step.state === 'pending' ? undefined : 'text-foreground'}>
              {step.label}
            </TraceTitle>
            {description && <TraceDescription className="text-xs">{description}</TraceDescription>}
          </TraceLine>
        );

        if (step.step === 'diagnose') {
          if (view.subagents.length === 0 && step.state !== 'running')
            return <div key={step.step}>{line}</div>;
          return (
            <TraceCollapsible key={step.step} defaultOpen>
              <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
              <TraceCollapsibleContent className="grid gap-3">
                {view.subagents.length > 0 ? (
                  view.subagents.map((agent) => <Subagent key={agent.agent} agent={agent} />)
                ) : (
                  <SubagentSkeleton />
                )}
              </TraceCollapsibleContent>
            </TraceCollapsible>
          );
        }

        const calls = toolCalls(step);
        if (calls.length === 0) return <div key={step.step}>{line}</div>;
        return (
          <TraceCollapsible key={step.step}>
            <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Trace className="gap-2">
                {calls.map((call) => (
                  <ToolCall key={call.id} call={call} />
                ))}
              </Trace>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        );
      })}
    </Trace>
  );
}

function SubagentSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true">
      {['Config agent', 'Reality agent'].map((label) => (
        <TraceLine key={label} status="running">
          <TraceIcon>
            <BotIcon />
          </TraceIcon>
          <TraceTitle>{label}</TraceTitle>
          <Skeleton className="h-3 w-24" />
        </TraceLine>
      ))}
    </div>
  );
}
