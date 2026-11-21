import { requestChanges } from '@/src/incident/approval';
import { respond } from '@/src/incident/http';

export async function POST(request: Request, ctx: RouteContext<'/api/incidents/[id]/request-changes'>) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { comment?: unknown };
  return respond(() => requestChanges(id, typeof body.comment === 'string' ? body.comment : undefined));
}
