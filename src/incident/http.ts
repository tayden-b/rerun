import { IncidentActionError } from './approval';

/** Maps incident action errors to 404/409 JSON responses. */
export async function respond(action: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await action());
  } catch (error) {
    if (error instanceof IncidentActionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
