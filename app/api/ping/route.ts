import { getRun, start } from 'workflow/api';
import { ping } from '@/workflows/ping';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === 'string' ? body.message : 'ping';
  const run = await start(ping, [message]);
  return Response.json({ runId: run.runId }, { status: 202 });
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get('runId');
  if (!runId) return Response.json({ error: 'runId query parameter is required' }, { status: 400 });
  const run = getRun(runId);
  const status = await run.status;
  const result = status === 'completed' ? await run.returnValue : null;
  return Response.json({ runId, status, result });
}
