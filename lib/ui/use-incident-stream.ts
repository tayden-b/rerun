'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export interface IncidentUpdatedEvent {
  id: string;
  status: string;
  lastSeq: number;
  costUsd: number;
  prUrl: string | null;
}

/** Subscribes to `/api/incidents/stream` and re-renders the route when a matching incident changes. */
export function useIncidentStream({ id, enabled = true }: { id?: string; enabled?: boolean } = {}): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const url = id ? `/api/incidents/stream?id=${encodeURIComponent(id)}` : '/api/incidents/stream';
    const source = new EventSource(url);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = () => {
      clearTimeout(pending);
      pending = setTimeout(() => router.refresh(), 150);
    };
    source.addEventListener('incident.updated', onUpdate);
    return () => {
      clearTimeout(pending);
      source.removeEventListener('incident.updated', onUpdate);
      source.close();
    };
  }, [id, enabled, router]);
}
