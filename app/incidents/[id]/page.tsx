import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { Skeleton } from '@/components/ui/skeleton';
import { WarRoom } from '@/components/war-room/war-room';
import { DEFAULT_TFE_ORG } from '@/lib/ui/format';
import { requestTime } from '@/lib/ui/time';
import { config } from '@/src/config';
import { getDb } from '@/src/db';
import { getIncident } from '@/src/db/incidents';

export default function IncidentPage({ params }: PageProps<'/incidents/[id]'>) {
  return (
    <Suspense fallback={<WarRoomSkeleton />}>
      <IncidentWarRoom params={params} />
    </Suspense>
  );
}

async function IncidentWarRoom({ params }: { params: PageProps<'/incidents/[id]'>['params'] }) {
  await connection();
  const { id } = await params;
  const detail = await getIncident(await getDb(), id);
  if (!detail) notFound();
  return (
    <WarRoom
      detail={detail}
      org={config.tfeOrg ?? DEFAULT_TFE_ORG}
      now={requestTime()}
      demo={config.mode === 'demo'}
    />
  );
}

function WarRoomSkeleton() {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 pt-5" aria-busy="true">
      <div className="grid gap-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96" />
        <Skeleton className="h-80" />
      </div>
    </main>
  );
}
