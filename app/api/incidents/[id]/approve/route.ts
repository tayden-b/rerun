import { approveIncident } from '@/src/incident/approval';
import { respond } from '@/src/incident/http';

export async function POST(_request: Request, ctx: RouteContext<'/api/incidents/[id]/approve'>) {
  const { id } = await ctx.params;
  return respond(() => approveIncident(id));
}
