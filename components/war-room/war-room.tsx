'use client';

import Link from 'next/link';
import { ChevronLeftIcon } from 'lucide-react';
import type { IncidentDetail } from '@/src/db/incidents';
import { ExternalLink } from '@/components/incidents/incident-table';
import { RelativeTime } from '@/components/incidents/relative-time';
import { StatusPill } from '@/components/incidents/status-pill';
import { ConfirmationBar } from '@/components/war-room/confirmation-bar';
import { FixDiff } from '@/components/war-room/fix-diff';
import { Investigation } from '@/components/war-room/investigation';
import { Section, SectionSkeleton } from '@/components/war-room/section';
import { TriageCard } from '@/components/war-room/triage-card';
import { Verification } from '@/components/war-room/verification';
import { buildIncidentView } from '@/lib/ui/incident-view';
import { baseModel, isReplay } from '@/src/telemetry/replay';
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

  return (
    <>
      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-8 px-6 pt-8 pb-12">
        <header className="grid gap-3">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs transition-colors"
          >
            <ChevronLeftIcon className="size-4" />
            Incidents
          </Link>
          <h1 className="text-xl font-semibold tracking-tight text-balance" data-testid="incident-title">
            {view.title}
          </h1>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            <StatusPill status={detail.status} />
            {detail.route && <span>{ROUTE_LABELS[detail.route as Route] ?? detail.route}</span>}
            <ExternalLink href={runUrl(org, detail.workspace, detail.runId)}>{detail.runId}</ExternalLink>
            {prUrl && (
              <ExternalLink href={prUrl}>{prLabel(prUrl, detail.prNumber ?? view.pr?.number)}</ExternalLink>
            )}
            <RelativeTime iso={detail.createdAt} now={now} />
          </div>
        </header>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 gap-8">
            <Section
              title="Investigation"
              meta={view.totalDurationMs ? formatDuration(view.totalDurationMs) : undefined}
            >
              <Investigation view={view} />
            </Section>
            <Section title="Fix">
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
          <aside className="grid gap-8 lg:sticky lg:top-20">
            <TriageCard triage={view.triage} />
            <Section
              title="Cost"
              meta={
                <span className="text-foreground font-mono tabular-nums">
                  {formatCost(detail.costUsd)}
                  {view.usage.some((u) => isReplay(u.model)) && (
                    <span className="text-muted-foreground"> est.</span>
                  )}
                </span>
              }
            >
              <div className="bg-card grid gap-2 rounded-lg border p-4 text-xs" data-testid="cost-card">
                {view.usage.map((u) => (
                  <div key={u.model} className="flex justify-between gap-4">
                    <span className="text-muted-foreground truncate font-mono">{baseModel(u.model)}</span>
                    <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
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
            </Section>
          </aside>
        </div>
      </main>
      {!SETTLED.has(detail.status) && view.pr && (
        <ConfirmationBar
          incidentId={detail.id}
          pr={view.pr}
          canDecide={detail.status === 'awaiting_approval'}
        />
      )}
    </>
  );
}
