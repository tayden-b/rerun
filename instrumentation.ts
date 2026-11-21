export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initTelemetry } = await import('./src/telemetry');
    initTelemetry();
    const { startPoller } = await import('./src/poller');
    startPoller();
  }
}
