import { eq, max } from 'drizzle-orm';
import type { Db } from '@/src/db';
import { incidentEvents, incidents } from '@/src/db/schema';

export interface IncidentSignature {
  id: string;
  status: string;
  lastSeq: number;
  costUsd: number;
  prUrl: string | null;
}

/** One row per incident with the fields whose change means the dashboard should re-render. */
export async function incidentSignatures(db: Db, id?: string): Promise<IncidentSignature[]> {
  const query = db
    .select({
      id: incidents.id,
      status: incidents.status,
      costUsd: incidents.costUsd,
      prUrl: incidents.prUrl,
      lastSeq: max(incidentEvents.seq),
    })
    .from(incidents)
    .leftJoin(incidentEvents, eq(incidentEvents.incidentId, incidents.id))
    .groupBy(incidents.id);
  const rows = await (id ? query.where(eq(incidents.id, id)) : query);
  return rows.map((row) => ({ ...row, lastSeq: row.lastSeq ?? 0 }));
}

export function signatureKey(s: IncidentSignature): string {
  return `${s.status}|${s.lastSeq}|${s.costUsd}|${s.prUrl ?? ''}`;
}
