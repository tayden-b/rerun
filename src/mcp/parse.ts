import { redact } from '../shared/redact';

/** Tolerant parse of a tool's text output: JSON when it parses, otherwise `{ text }`. */
export function parseToolText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      // not JSON; fall through
    }
  }
  return { text };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks a path of keys, returning undefined as soon as a segment is missing. */
export function dig(value: unknown, ...keys: string[]): unknown {
  let cur = value;
  for (const key of keys) {
    if (!isRecord(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** JSON:API resources come wrapped in `{ data: {...} }`; hand-written fixtures may omit the envelope. */
export function resource(value: unknown): Record<string, unknown> | undefined {
  const data = dig(value, 'data');
  if (isRecord(data)) return data;
  return isRecord(value) ? value : undefined;
}

export function relationshipId(value: unknown, name: string): string | undefined {
  const id = dig(resource(value), 'relationships', name, 'data', 'id');
  return typeof id === 'string' ? id : undefined;
}

export function attribute(value: unknown, name: string): unknown {
  return dig(resource(value), 'attributes', name);
}

interface Diagnostic {
  severity?: string;
  summary?: string;
  detail?: string;
  address?: string;
  range?: { filename?: string; start?: { line?: number } };
  snippet?: { context?: string | null; code?: string; start_line?: number };
}

function renderDiagnostic(d: Diagnostic): string[] {
  const label = d.severity === 'warning' ? 'Warning' : 'Error';
  const body: string[] = [`${label}: ${d.summary ?? ''}`, ''];
  if (d.address) body.push(`  with ${d.address},`);
  if (d.range?.filename) {
    const where = `  on ${d.range.filename} line ${d.range.start?.line ?? '?'}`;
    body.push(d.snippet?.context ? `${where}, in ${d.snippet.context}:` : `${where}:`);
    if (d.snippet?.code !== undefined) body.push(`  ${d.snippet.start_line ?? ''}: ${d.snippet.code}`);
    body.push('');
  }
  if (d.detail) body.push(...d.detail.trimEnd().split('\n'));
  return ['╷', ...body.map((line) => (line ? `│ ${line}` : '│')), '╵'];
}

/**
 * HCP Terraform logs with structured run output are JSON lines (`terraform.ui`). Renders them the way the
 * CLI prints them (diagnostics as `│ Error: ...` blocks, everything else as its `@message`) so
 * `extractErrorExcerpt` and humans see the familiar format. Plain-text lines pass through. Output is redacted.
 */
export function renderTerraformLog(log: string): string {
  const out: string[] = [];
  for (const line of log.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.startsWith('{')) {
      out.push(line);
      continue;
    }
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      out.push(line);
      continue;
    }
    if (!isRecord(entry)) {
      out.push(line);
    } else if (entry.type === 'diagnostic' && isRecord(entry.diagnostic)) {
      out.push(...renderDiagnostic(entry.diagnostic as Diagnostic));
    } else if (typeof entry['@message'] === 'string') {
      out.push(entry['@message']);
    } else {
      out.push(line);
    }
  }
  return redact(out.join('\n'));
}
