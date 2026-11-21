'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowUpRightIcon } from 'lucide-react';
import type { Incident } from '@/src/db/incidents';
import { FailureClassBadge } from '@/components/incidents/failure-class-badge';
import { RelativeTime } from '@/components/incidents/relative-time';
import { StatusPill } from '@/components/incidents/status-pill';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCost, prLabel, runUrl } from '@/lib/ui/format';
import { failureClassLabel, statusMeta } from '@/lib/ui/status';
import { useIncidentStream } from '@/lib/ui/use-incident-stream';

const ALL = 'all';

export function IncidentTable({ incidents, org, now }: { incidents: Incident[]; org: string; now: number }) {
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
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by status">
            <SelectValue />
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
            <SelectValue />
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
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-44 pl-4">Status</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Run</TableHead>
              <TableHead>PR</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="pr-4 text-right">Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="text-muted-foreground h-20 text-center text-sm">
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
                    className="hover:text-foreground font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {incident.workspace}
                  </Link>
                </TableCell>
                <TableCell>
                  <FailureClassBadge value={incident.failureClass} />
                </TableCell>
                <TableCell>
                  <ExternalLink href={runUrl(org, incident.workspace, incident.runId)}>
                    {incident.runId}
                  </ExternalLink>
                </TableCell>
                <TableCell>
                  {incident.prUrl ? (
                    <ExternalLink href={incident.prUrl}>
                      {prLabel(incident.prUrl, incident.prNumber)}
                    </ExternalLink>
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

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 font-mono text-xs transition-colors"
    >
      {children}
      <ArrowUpRightIcon className="size-3 opacity-60" />
    </a>
  );
}
