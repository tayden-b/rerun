import { getDb } from '@/src/db';
import { listIncidents } from '@/src/db/incidents';

export async function GET(request: Request): Promise<Response> {
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? '') || undefined;
  const incidents = await listIncidents(await getDb(), { limit });
  return Response.json({ incidents });
}
