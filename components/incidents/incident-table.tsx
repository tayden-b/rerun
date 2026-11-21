'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowUpRightIcon } from 'lucide-react';
import type { Incident } from '@/src/db/incidents';
import { RelativeTime } from '@/components/incidents/relative-time';
import { StatusPill } from '@/components/incidents/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCost, prLabel, runUrl } from '@/lib/ui/format';
import { failureClassLabel, statusMeta } from '@/lib/ui/status';
import { useIncidentStream } from '@/lib/ui/use-incident-stream';

const ALL = 'all';

export function IncidentTable({
  incidents,
  org,
  now,
  demo = false,
}: {
  incidents: Incident[];
  org: string;
  now: number;
  demo?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(ALL);
  const [failureClass, setFailureClass] = useState<string>(ALL);
  useIncidentStream();

  const statuses = useMemo(() => [...new Set(incidents.map((i) => i.status))], [incidents]);
  const classes = useMemo(
    () => [...new Set(incidents.map((i) => i.failureClass).filter((c): c is NonNullable<typeof c> => !!c))],
    [incidents],
  );
  const rows = incidents.filter(
    (i) =>
      (status === ALL || i.status === status) && (failureClass === ALL || i.failureClass === failureClass),
  );

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
            <SelectValue>{status === ALL ? 'All statuses' : statusMeta(status).label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {statusMeta(s).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={failureClass} onValueChange={setFailureClass}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by failure class">
            <SelectValue>
              {failureClass === ALL ? 'All classes' : failureClassLabel(failureClass)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All classes</SelectItem>
            {classes.map((c) => (
              <SelectItem key={c} value={c}>
                {failureClassLabel(c)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {rows.length} of {incidents.length}
        </span>
      </div>
      <div className="bg-card overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="text-muted-foreground hover:bg-transparent [&>th]:text-xs [&>th]:font-normal [&>th]:text-muted-foreground">
              <TableHead className="w-48 pl-4">Status</TableHead>
              <TableHead>Failure</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>PR</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="pr-4 text-right">Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="text-muted-foreground h-20 text-center text-sm">
                  No incidents match these filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((incident) => (
              <TableRow
                key={incident.id}
                data-testid="incident-row"
                className="cursor-pointer"
                onClick={() => router.push(`/incidents/${incident.id}`)}
              >
                <TableCell className="pl-4">
                  <StatusPill status={incident.status} />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="text-foreground text-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {failureClassLabel(incident.failureClass)}
                    {incident.stage && <span className="text-muted-foreground"> at {incident.stage}</span>}
                  </Link>
                </TableCell>
                <TableCell>
                  <ExternalLink href={runUrl(org, incident.workspace, incident.runId)}>
                    {incident.runId}
                  </ExternalLink>
                </TableCell>
                <TableCell>
                  {incident.prUrl ? (
                    <PrRef url={incident.prUrl} number={incident.prNumber} demo={demo} />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-right font-mono text-xs tabular-nums">
                  {formatCost(incident.costUsd)}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <RelativeTime iso={incident.createdAt} now={now} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** Demo PRs live in the fake GitHub, so their numbers are plain text rather than links to real PRs. */
export function PrRef({ url, number, demo }: { url: string; number?: number | null; demo: boolean }) {
  if (!demo) return <ExternalLink href={url}>{prLabel(url, number)}</ExternalLink>;
  return (
    <span
      className="text-muted-foreground font-mono text-xs"
      data-testid="pr-ref"
      title="Opened in the demo's fake GitHub"
    >
      {prLabel(url, number)} · demo
    </span>
  );
}

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-mono text-xs transition-colors"
    >
      {children}
      <ArrowUpRightIcon className="size-3 opacity-60" />
    </a>
  );
}
