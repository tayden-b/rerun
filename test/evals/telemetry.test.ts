import { describe, expect, it } from 'vitest';
import {
  aiTelemetry,
  buildSpanProcessors,
  initTelemetry,
  redactDeep,
  telemetryConfigFromEnv,
} from '../../src/telemetry';

describe('telemetry', () => {
  it('reads exporters from the environment', () => {
    expect(telemetryConfigFromEnv({ RERUN_TRACE_CONSOLE: '1' }).console).toBe(true);
    expect(telemetryConfigFromEnv({}).console).toBe(false);
  });

  it('builds a console processor and a Langfuse processor only when keys are set', () => {
    expect(buildSpanProcessors({ serviceName: 't', console: false, langfuse: {} }).exporters).toEqual([]);
    expect(
      buildSpanProcessors({ serviceName: 't', console: true, langfuse: { publicKey: 'pk-lf-test' } })
        .exporters,
    ).toEqual(['console']);
    const both = buildSpanProcessors({
      serviceName: 't',
      console: true,
      langfuse: { publicKey: 'pk-lf-test', secretKey: 'sk-lf-test', baseUrl: 'http://127.0.0.1:1' },
    });
    expect(both.exporters).toEqual(['console', 'langfuse']);
    expect(both.processors).toHaveLength(2);
  });

  it('is a no-op without exporters and keeps AI SDK telemetry off', async () => {
    const handle = initTelemetry({ serviceName: 't', console: false, langfuse: {} });
    expect(handle.enabled).toBe(false);
    expect(aiTelemetry('rerun.test', { scenario: 'x' })).toEqual({
      isEnabled: false,
      functionId: 'rerun.test',
      metadata: { scenario: 'x' },
    });
    await handle.shutdown();
  });

  it('redacts tokens inside nested span data', () => {
    const out = JSON.stringify(
      redactDeep({ a: ['Bearer abcdefghijklmnopqrstuvwxyz0123456789'], b: { n: 1 } }),
    );
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).toContain('"n":1');
  });
});
