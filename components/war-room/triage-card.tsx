'use client';

import { CircleXIcon } from 'lucide-react';
import { ProbabilityBar } from '@/components/incidents/probability-bar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { formatPercent, formatTokens } from '@/lib/ui/format';
import { failureClassLabel } from '@/lib/ui/status';
import { formatDuration } from '@/lib/ui/time';
import type { TriageResult } from '@/src/shared/types';

function runnerUp(probabilities: Record<string, number>, choice: string): string | undefined {
  const [next] = Object.entries(probabilities)
    .filter(([key]) => key !== choice)
    .sort((a, b) => b[1] - a[1]);
  return next ? `Next: ${failureClassLabel(next[0])} ${formatPercent(next[1])}` : undefined;
}

function likeliestLegend(blast: TriageResult['blastRadius']): string | undefined {
  const [top] = Object.entries(blast.probabilities).sort((a, b) => b[1] - a[1]);
  return top ? blast.legend[top[0]] : undefined;
}

export function TriageCard({ triage }: { triage?: TriageResult }) {
  return (
    <Card size="sm" data-testid="triage-card" className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          Triage
          {triage && (
            <span className="text-muted-foreground font-mono text-xs font-normal">
              {triage.provider} · {formatTokens(triage.inputTokens)} tok · {formatDuration(triage.latencyMs)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {triage ? (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="rounded-md font-mono font-normal">
                {failureClassLabel(triage.failureClass.choice)}
              </Badge>
              <span className="text-muted-foreground text-xs">at {triage.stage}</span>
            </div>
            <div className="grid gap-3.5">
              <ProbabilityBar
                label="Failure class"
                value={triage.failureClass.confidence}
                detail={runnerUp(triage.failureClass.probabilities, triage.failureClass.choice)}
              />
              <ProbabilityBar label="Fixable in config" value={triage.configFixable.noul} />
              <ProbabilityBar
                label="Blast radius"
                value={triage.blastRadius.score}
                detail={likeliestLegend(triage.blastRadius)}
                emphasis="muted"
              />
              <ProbabilityBar label="Needs a human" value={triage.needsHuman.noul} emphasis="muted" />
            </div>
            <StackTrace excerpt={triage.errorExcerpt} />
          </>
        ) : (
          <div className="grid gap-4" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid gap-1.5">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-1.5" />
              </div>
            ))}
            <Skeleton className="h-16" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StackTrace({ excerpt }: { excerpt: string }) {
  const [first, ...rest] = excerpt.split('\n');
  const heading = first.replace(/^Error:\s*/, '');
  return (
    <TraceCollapsible defaultOpen data-testid="stack-trace">
      <TraceCollapsibleTrigger>
        <TraceLine status="error">
          <TraceIcon>
            <CircleXIcon />
          </TraceIcon>
          <TraceTitle>Failed: {heading}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="ml-0 border-l-0 pl-0">
        <pre className="bg-background text-muted-foreground max-h-48 overflow-auto rounded-md border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre">
          {rest.join('\n').trim() || first}
        </pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
