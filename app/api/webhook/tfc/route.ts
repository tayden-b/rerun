import { config } from '@/src/config';
import { startIncident } from '@/src/incident/start';
import {
  SIGNATURE_HEADER,
  erroredRunFor,
  verifySignature,
  type TfcNotification,
} from '@/src/incident/webhook';

export async function POST(request: Request) {
  const secret = config.tfcWebhookSecret;
  if (!secret) return new Response(null, { status: 404 });
  const body = await request.text();
  if (!verifySignature(body, request.headers.get(SIGNATURE_HEADER), secret)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  let payload: TfcNotification;
  try {
    payload = JSON.parse(body) as TfcNotification;
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const runId = erroredRunFor(payload, config.workspace);
  if (!runId) return Response.json({ accepted: false }, { status: 202 });
  const { incident, created } = await startIncident(runId);
  return Response.json({ accepted: true, incidentId: incident.id, created }, { status: 202 });
}
