'use client';

import { CircleXIcon } from 'lucide-react';
import { ProbabilityBar } from '@/components/incidents/probability-bar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { Section } from '@/components/war-room/section';
import { formatPercent, formatTokens } from '@/lib/ui/format';
import { readableLog } from '@/lib/ui/log';
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

/** Highest level on the Jev score scale (SPEC §3 blast_radius has levels 0–3). */
function scoreMax(answer: TriageResult['blastRadius']): number {
  const levels = [...Object.keys(answer.legend), ...Object.keys(answer.probabilities)]
    .map(Number)
    .filter(Number.isFinite);
  return levels.length > 0 ? Math.max(...levels) : 3;
}

export function TriageCard({ triage }: { triage?: TriageResult }) {
  return (
    <Section
      title="Triage"
      data-testid="triage-card"
      meta={
        triage && (
          <span className="font-mono">
            {triage.provider} · {formatTokens(triage.inputTokens)} tok · {formatDuration(triage.latencyMs)}
          </span>
        )
      }
    >
      <div className="bg-card grid gap-4 rounded-lg border p-4">
        {triage ? (
          <>
            <p className="text-sm">
              <span className="text-foreground font-medium">
                {failureClassLabel(triage.failureClass.choice)}
              </span>
              <span className="text-muted-foreground"> at {triage.stage}</span>
            </p>
            <div className="grid gap-4">
              <ProbabilityBar
                label="Failure class"
                value={triage.failureClass.confidence}
                detail={runnerUp(triage.failureClass.probabilities, triage.failureClass.choice)}
              />
              <ProbabilityBar label="Fixable in config" value={triage.configFixable.noul} />
              <ProbabilityBar
                label="Blast radius"
                value={triage.blastRadius.score / scoreMax(triage.blastRadius)}
                valueText={`${triage.blastRadius.score.toFixed(1)} / ${scoreMax(triage.blastRadius)}`}
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
              <div key={i} className="grid gap-2">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-1.5" />
              </div>
            ))}
            <Skeleton className="h-16" />
          </div>
        )}
      </div>
    </Section>
  );
}

export function StackTrace({ excerpt }: { excerpt: string }) {
  const { heading, lines } = readableLog(excerpt);
  const body = lines.join('\n').trim();
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
        <pre
          tabIndex={0}
          aria-label="Error log"
          className="bg-background text-muted-foreground scroll-fade-y max-h-56 overflow-y-auto rounded-md border px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        >
          {body || heading}
        </pre>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
