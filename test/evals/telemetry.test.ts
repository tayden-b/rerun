import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';
import {
  aiTelemetry,
  buildSpanProcessors,
  RedactingConsoleSpanExporter,
  initTelemetry,
  redactDeep,
  telemetryConfigFromEnv,
} from '../../src/telemetry';

describe('telemetry', () => {
  it('reads exporters from the environment', () => {
    expect(telemetryConfigFromEnv({ RERUN_TRACE_CONSOLE: '1' }).console).toBe(true);
    expect(telemetryConfigFromEnv({}).console).toBe(false);
  });

  it('never exports to Langfuse outside live mode', () => {
    const keys = { LANGFUSE_PUBLIC_KEY: 'pk-lf-test', LANGFUSE_SECRET_KEY: 'sk-lf-test' };
    expect(telemetryConfigFromEnv({ ...keys, RERUN_MODE: 'demo' }).langfuse).toEqual({});
  });

  it('redacts span and event attributes on the console exporter', async () => {
    const dir = vi.spyOn(console, 'dir').mockImplementation(() => {});
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new RedactingConsoleSpanExporter())],
    });
    const span = provider
      .getTracer('t')
      .startSpan('s', { attributes: { prompt: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789' } });
    span.addEvent('e', { out: 'Bearer zyxwvutsrqponmlkjihgfedcba9876543210' });
    span.end();
    await provider.shutdown();
    const printed = JSON.stringify(dir.mock.calls);
    dir.mockRestore();
    expect(printed).toContain('[REDACTED:bearer]');
    expect(printed).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
    expect(printed).not.toContain('zyxwvutsrqponmlkjihgfedcba9876543210');
    expect(printed).toContain('"name":"s"');
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
