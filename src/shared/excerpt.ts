import { redact } from './redact';

export const EXCERPT_MAX_LINES = 120;
const CONTEXT_AFTER_FIRST_ERROR = 20;
const SIGNAL = /Error|error|failed|Failed|│/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * SPEC §4: keep signal lines plus 20 lines of context after the first `Error:`,
 * cap at 120 lines, redact secrets. When over the cap, the first `Error:` block is
 * always kept and the remaining budget goes to the signal lines closest to the end
 * of the log. A log with no signal lines falls back to its last 120 lines.
 */
export function extractErrorExcerpt(log: string): string {
  const lines = log.replace(ANSI, '').replace(/\r\n?/g, '\n').split('\n');

  const firstError = lines.findIndex((line) => line.includes('Error:'));
  const block = new Set<number>();
  if (firstError >= 0) {
    const end = Math.min(lines.length - 1, firstError + CONTEXT_AFTER_FIRST_ERROR);
    for (let i = firstError; i <= end; i++) block.add(i);
  }

  const signal: number[] = [];
  lines.forEach((line, i) => {
    if (!block.has(i) && SIGNAL.test(line)) signal.push(i);
  });

  let keep: number[];
  if (block.size === 0 && signal.length === 0) {
    keep = lines.map((_, i) => i).slice(-EXCERPT_MAX_LINES);
  } else {
    const budget = Math.max(0, EXCERPT_MAX_LINES - block.size);
    const blockLines = [...block].slice(0, EXCERPT_MAX_LINES);
    keep = [...blockLines, ...(budget > 0 ? signal.slice(-budget) : [])].sort((a, b) => a - b);
  }

  return redact(
    keep
      .map((i) => lines[i])
      .join('\n')
      .trimEnd(),
  );
}
