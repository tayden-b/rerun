import { Suspense } from 'react';
import { connection } from 'next/server';
import { config } from '@/src/config';
import { getDb } from '@/src/db';
import { listIncidents } from '@/src/db/incidents';

// Placeholder list from W0-A; W1-E replaces this page with the real dashboard.
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Rerun</h1>
        <span className="text-muted-foreground font-mono text-xs">{config.mode}</span>
      </header>
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading incidents…</p>}>
        <IncidentList />
      </Suspense>
    </main>
  );
}

async function IncidentList() {
  await connection();
  const incidents = await listIncidents(await getDb());
  if (incidents.length === 0) {
    return <p className="text-muted-foreground text-sm">No incidents yet. Run `npm run demo` to seed one.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-muted-foreground text-left text-xs">
        <tr>
          <th className="py-2 font-medium">Run</th>
          <th className="py-2 font-medium">Workspace</th>
          <th className="py-2 font-medium">Status</th>
          <th className="py-2 font-medium">Class</th>
          <th className="py-2 font-medium">Created</th>
        </tr>
      </thead>
      <tbody>
        {incidents.map((incident) => (
          <tr key={incident.id} className="border-t" data-testid="incident-row">
            <td className="py-2 font-mono">{incident.runId}</td>
            <td className="py-2">{incident.workspace}</td>
            <td className="py-2">{incident.status}</td>
            <td className="py-2 font-mono">{incident.failureClass ?? '—'}</td>
            <td className="text-muted-foreground py-2 font-mono text-xs">{incident.createdAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
