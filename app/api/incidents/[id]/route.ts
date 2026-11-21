import { getDb } from '@/src/db';
import { getIncident } from '@/src/db/incidents';

export async function GET(_request: Request, ctx: RouteContext<'/api/incidents/[id]'>): Promise<Response> {
  const { id } = await ctx.params;
  const incident = await getIncident(await getDb(), id);
  if (!incident) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ incident });
}
