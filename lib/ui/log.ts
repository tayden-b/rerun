export interface ReadableLog {
  heading: string;
  lines: string[];
}

interface JsonLogLine {
  '@level'?: string;
  '@message'?: string;
  diagnostic?: {
    summary?: string;
    detail?: string;
    address?: string;
    range?: { filename?: string; start?: { line?: number } };
  };
}

function parseJsonLine(line: string): JsonLogLine | null {
  if (!line.startsWith('{')) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' && '@message' in value ? (value as JsonLogLine) : null;
  } catch {
    return null;
  }
}

function diagnosticLines(d: NonNullable<JsonLogLine['diagnostic']>): string[] {
  const lines: string[] = [];
  const where = [d.address, d.range?.filename && `${d.range.filename} line ${d.range.start?.line ?? '?'}`]
    .filter(Boolean)
    .join(', ');
  if (where) lines.push(`  on ${where}`);
  for (const line of (d.detail ?? '').trim().split('\n')) if (line) lines.push(`  ${line}`);
  return lines;
}

/** Turns an error excerpt (plain text or Terraform's JSON log lines) into a heading and readable lines. */
export function readableLog(excerpt: string): ReadableLog {
  const raw = excerpt.trim().split('\n');
  let heading: string | undefined;
  const lines: string[] = [];
  for (const line of raw) {
    const json = parseJsonLine(line);
    if (!json) {
      lines.push(line);
      continue;
    }
    const message = json['@message'] ?? '';
    lines.push(message);
    if (json['@level'] === 'error') {
      heading ??= message;
      if (json.diagnostic) lines.push(...diagnosticLines(json.diagnostic));
    }
  }
  const first = heading ?? lines.find((l) => l.trim()) ?? '';
  return {
    heading: first.replace(/^Error:\s*/, ''),
    lines: heading ? lines : lines.slice(lines.indexOf(first) + 1),
  };
}
