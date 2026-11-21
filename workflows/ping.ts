export interface PingResult {
  pong: string;
  at: string;
}

export async function ping(message: string): Promise<PingResult> {
  'use workflow';
  return pong(message);
}

async function pong(message: string): Promise<PingResult> {
  'use step';
  return { pong: message, at: new Date().toISOString() };
}
