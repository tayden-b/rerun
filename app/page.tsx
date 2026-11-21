import { Suspense } from 'react';
import { connection } from 'next/server';
import { EmptyState } from '@/components/incidents/empty-state';
import { IncidentTable } from '@/components/incidents/incident-table';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_TFE_ORG } from '@/lib/ui/format';
import { requestTime } from '@/lib/ui/time';
import { config } from '@/src/config';
import { getDb } from '@/src/db';
import { listIncidents } from '@/src/db/incidents';

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 pt-8 pb-12">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Failed runs in this workspace and what Rerun did about them.
        </p>
      </header>
      <Suspense fallback={<ListSkeleton />}>
        <IncidentList />
      </Suspense>
    </main>
  );
}

async function IncidentList() {
  await connection();
  const incidents = await listIncidents(await getDb());
  if (incidents.length === 0) return <EmptyState workspace={config.workspace} />;
  return (
    <IncidentTable
      incidents={incidents}
      org={config.tfeOrg ?? DEFAULT_TFE_ORG}
      now={requestTime()}
      demo={config.mode === 'demo'}
    />
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-44" />
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 rounded-none" />
        ))}
      </div>
    </div>
  );
}
