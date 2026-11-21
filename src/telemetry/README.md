# src/telemetry/ — tracing and Langfuse export. Owner: W1-F.

- `initTelemetry()` starts the OpenTelemetry NodeSDK once (registered by root `instrumentation.ts`). Exporters: console when `RERUN_TRACE_CONSOLE=1`, Langfuse (`@langfuse/otel`) when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set. Span data passes through `redact()`.
- Pass `experimental_telemetry: aiTelemetry('rerun.<step>')` to AI SDK calls to emit spans.
- `cost.ts`: dated price table, `estimateCostUsd`, `jevCostUsd`, `summarizeIncidentCost`.
