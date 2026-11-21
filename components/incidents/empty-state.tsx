'use client';

import { useIncidentStream } from '@/lib/ui/use-incident-stream';

export function EmptyState({ workspace }: { workspace: string }) {
  useIncidentStream();
  return (
    <div data-testid="empty-state" className="bg-card grid gap-5 rounded-lg border px-6 py-10">
      <div>
        <h2 className="text-sm font-medium">No incidents yet</h2>
        <p className="text-muted-foreground mt-1 max-w-prose text-sm">
          Rerun opens an incident when a run in <span className="text-foreground font-mono">{workspace}</span>{' '}
          fails. This page updates on its own when one arrives.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Command
          label="Break the fixture workspace (in rerun-fixtures)"
          command="scripts/break.sh apply-time-exit-1"
        />
        <Command label="Or run the demo with recorded data" command="npm run demo" />
      </div>
    </div>
  );
}

function Command({ label, command }: { label: string; command: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <code className="bg-background rounded-md border px-3 py-2 font-mono text-xs">{command}</code>
    </div>
  );
}
