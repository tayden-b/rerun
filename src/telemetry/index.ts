import { LangfuseSpanProcessor } from '@langfuse/otel';
import type { AttributeValue } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { loadConfig } from '../config';
import { redact } from '../shared/redact';

export interface TelemetryConfig {
  serviceName: string;
  /** Print every span to stdout (`RERUN_TRACE_CONSOLE=1`). */
  console: boolean;
  langfuse: { publicKey?: string; secretKey?: string; baseUrl?: string };
}

export interface TelemetryHandle {
  enabled: boolean;
  exporters: ('console' | 'langfuse')[];
  shutdown(): Promise<void>;
}

type Env = Record<string, string | undefined>;

export function telemetryConfigFromEnv(env: Env = process.env): TelemetryConfig {
  const config = loadConfig(env);
  return {
    serviceName: 'rerun',
    console: env.RERUN_TRACE_CONSOLE === '1',
    // Traces leave the machine only in live mode; demo and tests never export to Langfuse.
    langfuse: config.mode === 'live' ? config.langfuse : {},
  };
}

/** Deeply applies `redact()` to every string so no token reaches an exporter. */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v)]));
  }
  return value;
}

/** Console exporter that prints span and event attributes through `redact()`. */
export class RedactingConsoleSpanExporter extends ConsoleSpanExporter {
  override export(spans: ReadableSpan[], resultCallback: Parameters<ConsoleSpanExporter['export']>[1]): void {
    super.export(
      spans.map((span) =>
        Object.create(span, {
          attributes: { value: redactDeep(span.attributes) },
          events: { value: span.events.map((e) => ({ ...e, attributes: redactDeep(e.attributes) })) },
        }),
      ),
      resultCallback,
    );
  }
}

export function buildSpanProcessors(config: TelemetryConfig): {
  processors: SpanProcessor[];
  exporters: TelemetryHandle['exporters'];
} {
  const processors: SpanProcessor[] = [];
  const exporters: TelemetryHandle['exporters'] = [];
  if (config.console) {
    processors.push(new SimpleSpanProcessor(new RedactingConsoleSpanExporter()));
    exporters.push('console');
  }
  const { publicKey, secretKey, baseUrl } = config.langfuse;
  if (publicKey && secretKey) {
    processors.push(
      new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl, mask: ({ data }) => redactDeep(data) }),
    );
    exporters.push('langfuse');
  }
  return { processors, exporters };
}

let active: TelemetryHandle | undefined;

/**
 * Starts the OpenTelemetry NodeSDK once per process. AI SDK calls emit spans when they pass
 * `experimental_telemetry: aiTelemetry(...)`. With no exporter configured this is a no-op.
 */
export function initTelemetry(config: TelemetryConfig = telemetryConfigFromEnv()): TelemetryHandle {
  if (active) return active;
  const { processors, exporters } = buildSpanProcessors(config);
  if (processors.length === 0) {
    active = { enabled: false, exporters, shutdown: async () => {} };
    return active;
  }
  const sdk = new NodeSDK({ serviceName: config.serviceName, spanProcessors: processors });
  sdk.start();
  active = {
    enabled: true,
    exporters,
    shutdown: async () => {
      await sdk.shutdown();
      active = undefined;
    },
  };
  return active;
}

/** `experimental_telemetry` settings for an AI SDK call; enabled only when `initTelemetry` started an exporter. */
export function aiTelemetry(
  functionId: string,
  metadata: Record<string, AttributeValue> = {},
): { isEnabled: boolean; functionId: string; metadata: Record<string, AttributeValue> } {
  return { isEnabled: active?.enabled ?? false, functionId, metadata };
}
