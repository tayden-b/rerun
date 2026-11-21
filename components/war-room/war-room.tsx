'use client';

import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';
import type { IncidentDetail } from '@/src/db/incidents';
import { ExternalLink } from '@/components/incidents/incident-table';
import { RelativeTime } from '@/components/incidents/relative-time';
import { StatusPill } from '@/components/incidents/status-pill';
import { Badge } from '@/components/ui/badge';
import { ConfirmationBar } from '@/components/war-room/confirmation-bar';
import { FixDiff } from '@/components/war-room/fix-diff';
import { Investigation } from '@/components/war-room/investigation';
import { Section, SectionSkeleton } from '@/components/war-room/section';
import { TriageCard } from '@/components/war-room/triage-card';
import { Verification } from '@/components/war-room/verification';
import { buildIncidentView } from '@/lib/ui/incident-view';
import { formatCost, formatTokens, prLabel, runUrl } from '@/lib/ui/format';
import { ROUTE_LABELS } from '@/lib/ui/status';
import { formatDuration } from '@/lib/ui/time';
import { useIncidentStream } from '@/lib/ui/use-incident-stream';
import type { Route } from '@/src/shared/types';

const SETTLED = new Set(['resolved', 'failed', 'needs_human']);

export function WarRoom({ detail, org, now }: { detail: IncidentDetail; org: string; now: number }) {
  useIncidentStream({ id: detail.id, enabled: !SETTLED.has(detail.status) });
  const view = buildIncidentView(detail);
  const prUrl = detail.prUrl ?? view.pr?.url;
  const fixStep = view.steps.find((s) => s.step === 'fix');
  const verifyStep = view.steps.find((s) => s.step === 'verify');
  const tokens = view.usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);

  return (
    <>
      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-6 pt-5 pb-10">
        <header className="grid gap-2">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs transition-colors"
          >
            <ChevronLeftIcon className="size-3.5" />
            Incidents
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-balance" data-testid="incident-title">
            {view.title}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <StatusPill status={detail.status} />
            {detail.route && (
              <Badge variant="outline" className="text-muted-foreground rounded-md font-normal">
                {ROUTE_LABELS[detail.route as Route] ?? detail.route}
              </Badge>
            )}
            <ExternalLink href={runUrl(org, detail.workspace, detail.runId)}>{detail.runId}</ExternalLink>
            {prUrl && (
              <ExternalLink href={prUrl}>{prLabel(prUrl, detail.prNumber ?? view.pr?.number)}</ExternalLink>
            )}
            <span className="font-mono">{detail.workspace}</span>
            <RelativeTime iso={detail.createdAt} now={now} />
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid min-w-0 gap-8">
            <Section title="Investigation" meta={formatDuration(view.totalDurationMs)}>
              <Investigation view={view} />
            </Section>
            <Section title="Fix" meta={view.patch ? view.patch.title : undefined}>
              {view.patch ? (
                <FixDiff patch={view.patch} />
              ) : (
                <SectionSkeleton
                  caption={
                    fixStep?.state === 'running' ? 'The fix agent is writing a patch.' : 'No patch yet.'
                  }
                  lines={5}
                />
              )}
            </Section>
            <Section title="Verification">
              {view.verify ? (
                <Verification verify={view.verify} />
              ) : (
                <SectionSkeleton
                  caption={
                    verifyStep?.state === 'running'
                      ? 'Running fmt, validate and a speculative plan.'
                      : 'Not verified yet.'
                  }
                />
              )}
            </Section>
          </div>
          <aside className="grid gap-4 lg:sticky lg:top-16">
            <TriageCard triage={view.triage} />
            <div className="bg-card grid gap-2 rounded-lg border p-4 text-xs" data-testid="cost-card">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cost</span>
                <span className="font-mono tabular-nums">{formatCost(detail.costUsd)}</span>
              </div>
              {view.usage.map((u) => (
                <div key={u.model} className="flex justify-between">
                  <span className="text-muted-foreground font-mono">{u.model}</span>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {formatTokens(u.inputTokens)} in · {formatTokens(u.outputTokens)} out
                  </span>
                </div>
              ))}
              {view.jevTokens > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-mono">jev</span>
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {formatTokens(view.jevTokens)} in
                  </span>
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>
      <ConfirmationBar
        incidentId={detail.id}
        pr={view.pr}
        canDecide={detail.status === 'awaiting_approval'}
        meta={
          <span className="font-mono tabular-nums">
            {formatCost(detail.costUsd)} · {formatDuration(view.totalDurationMs)} · {formatTokens(tokens)}{' '}
            tokens
          </span>
        }
      />
    </>
  );
}
