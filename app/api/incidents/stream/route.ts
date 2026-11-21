import { getDb } from '@/src/db';
import { incidentSignatures, signatureKey } from '@/lib/ui/incident-signatures';

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events. `GET /api/incidents/stream[?id=<incidentId>]`.
 * Polls the DB every 2s and emits `event: incident.updated` with `data: {id,status,lastSeq,costUsd,prUrl}`
 * for each incident that was created or whose status, last event seq, cost or PR changed.
 * Sends `event: ready` once connected and a `: ping` comment every 15s.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? undefined;
  const db = await getDb();
  const encoder = new TextEncoder();
  const seen = new Map((await incidentSignatures(db, id)).map((s) => [s.id, signatureKey(s)]));
  let poll: ReturnType<typeof setInterval> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          stop();
        }
      };
      const stop = () => {
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };
      request.signal.addEventListener('abort', stop);
      send(`retry: ${POLL_MS}\nevent: ready\ndata: ${JSON.stringify({ incidents: seen.size })}\n\n`);
      poll = setInterval(async () => {
        try {
          for (const signature of await incidentSignatures(db, id)) {
            const key = signatureKey(signature);
            if (seen.get(signature.id) === key) continue;
            seen.set(signature.id, key);
            send(`event: incident.updated\ndata: ${JSON.stringify(signature)}\n\n`);
          }
        } catch (error) {
          send(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
        }
      }, POLL_MS);
      heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
    },
    cancel() {
      clearInterval(poll);
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
