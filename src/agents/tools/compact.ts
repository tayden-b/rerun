import { redact } from '../../shared/redact';

export const TOOL_OUTPUT_MAX_CHARS = 8000;
export const TRUNCATED_MARKER = '\n[truncated]';

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  // MCP CallToolResult: join its text parts rather than echoing the envelope.
  if (value && typeof value === 'object' && Array.isArray((value as { content?: unknown }).content)) {
    const parts = (value as { content: Array<{ type?: string; text?: unknown }> }).content;
    const texts = parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text);
    if (texts.length === parts.length && texts.length > 0) {
      const joined = texts.join('\n');
      return (value as { isError?: boolean }).isError ? `ERROR: ${joined}` : joined;
    }
  }
  return JSON.stringify(value);
}

/** Every tool output goes through this: stringified, secrets redacted, capped at 8k chars. */
export function compact(value: unknown, max = TOOL_OUTPUT_MAX_CHARS): string {
  const text = redact(textOf(value));
  if (text.length <= max) return text;
  return text.slice(0, max - TRUNCATED_MARKER.length) + TRUNCATED_MARKER;
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
export const stripAnsi = (text: string) => text.replace(ANSI, '');

const MAX_PATTERN = 300;

/** Compiles a model-supplied regex; returns an error message instead of throwing. */
export function compileRegex(pattern: string, ignoreCase = false): RegExp | string {
  if (pattern.length > MAX_PATTERN) return `ERROR: pattern longer than ${MAX_PATTERN} characters`;
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : '');
  } catch (error) {
    return `ERROR: invalid regex: ${(error as Error).message}`;
  }
}

/** Parses JSON text if given a string; returns other values unchanged. */
export function asJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
