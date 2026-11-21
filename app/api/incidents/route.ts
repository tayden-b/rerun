import { getDb } from '@/src/db';
import { listIncidents } from '@/src/db/incidents';
import { startIncident } from '@/src/incident/start';

export async function GET(request: Request): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '') || undefined;
  const incidents = await listIncidents(await getDb(), { limit });
  return Response.json({ incidents });
}

/**
 * Starts (or returns) the incident for an errored run. The workflow can only be started from inside the
 * app, so out-of-process callers such as `npm run eval -- --live` come through here.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = body?.runId;
  if (typeof runId !== 'string' || !/^run-[A-Za-z0-9-]+$/.test(runId)) {
    return Response.json({ error: 'runId must be an HCP Terraform run id' }, { status: 400 });
  }
  const { incident, created } = await startIncident(runId);
  return Response.json({ incident, created }, { status: created ? 201 : 200 });
}
