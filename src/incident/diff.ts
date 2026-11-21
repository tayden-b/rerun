import type { PatchFile } from '../shared/types';

/** Unified diff of a patch (whole-file hunks), for the `diff` artifact and the PR. */
export function patchToDiff(files: PatchFile[]): string {
  return files.map(fileDiff).join('');
}

function fileDiff(file: PatchFile): string {
  const a = file.before === null ? [] : file.before.split('\n');
  const b = file.after.split('\n');
  const lines = lineDiff(a, b);
  const header = `--- ${file.before === null ? '/dev/null' : `a/${file.path}`}\n+++ b/${file.path}\n`;
  return `${header}@@ -1,${a.length} +1,${b.length} @@\n${lines.join('\n')}\n`;
}

function lineDiff(a: string[], b: string[]): string[] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push(` ${a[i++]}`);
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      out.push(`+${b[j++]}`);
    } else {
      out.push(`-${a[i++]}`);
    }
  }
  return out;
}
