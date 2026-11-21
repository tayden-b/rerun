export type DiffRow =
  | { type: 'context' | 'added' | 'removed'; text: string; oldLine?: number; newLine?: number }
  | { type: 'hunk'; text: string };

type Op = { type: 'context' | 'added' | 'removed'; text: string };

const MAX_CELLS = 4_000_000;

function lineOps(a: string[], b: string[]): Op[] {
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ type: 'removed' as const, text })),
      ...b.map((text) => ({ type: 'added' as const, text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ type: 'removed', text: a[i++] });
    } else {
      ops.push({ type: 'added', text: b[j++] });
    }
  }
  while (i < n) ops.push({ type: 'removed', text: a[i++] });
  while (j < m) ops.push({ type: 'added', text: b[j++] });
  return ops;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
}

/** Line diff of two file versions as unified-diff rows with `context` lines around each change. */
export function diffLines(before: string | null, after: string, context = 3): DiffRow[] {
  const ops = lineOps(splitLines(before ?? ''), splitLines(after));
  const numbered = ops.map((op, index) => ({ ...op, index }));
  let oldLine = 0;
  let newLine = 0;
  const withNumbers = numbered.map((op) => {
    const oldStart = oldLine + 1;
    const newStart = newLine + 1;
    if (op.type !== 'added') oldLine++;
    if (op.type !== 'removed') newLine++;
    return {
      ...op,
      oldStart,
      newStart,
      oldLine: op.type === 'added' ? undefined : oldLine,
      newLine: op.type === 'removed' ? undefined : newLine,
    };
  });

  const changed = withNumbers.filter((op) => op.type !== 'context').map((op) => op.index);
  if (changed.length === 0) return [];

  const keep = new Set<number>();
  for (const index of changed) {
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++)
      keep.add(k);
  }

  const rows: DiffRow[] = [];
  let previous = -2;
  for (const op of withNumbers) {
    if (!keep.has(op.index)) continue;
    if (op.index !== previous + 1) {
      rows.push({ type: 'hunk', text: `@@ -${op.oldStart} +${op.newStart} @@` });
    }
    rows.push({ type: op.type, text: op.text, oldLine: op.oldLine, newLine: op.newLine });
    previous = op.index;
  }
  return rows;
}

export function diffStat(rows: DiffRow[]): { added: number; removed: number } {
  return {
    added: rows.filter((row) => row.type === 'added').length,
    removed: rows.filter((row) => row.type === 'removed').length,
  };
}
