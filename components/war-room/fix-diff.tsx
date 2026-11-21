'use client';

import { FileCodeIcon } from 'lucide-react';
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block';
import { diffLines, diffStat } from '@/lib/ui/diff';
import type { Patch, PatchFile } from '@/src/shared/types';

export function FixDiff({ patch }: { patch: Patch }) {
  return (
    <div className="grid gap-4">
      {patch.summary && <p className="text-muted-foreground text-sm">{patch.summary}</p>}
      {patch.files.map((file) => (
        <FileDiff key={file.path} file={file} />
      ))}
    </div>
  );
}

function FileDiff({ file }: { file: PatchFile }) {
  const rows = diffLines(file.before, file.after);
  const stat = diffStat(rows);
  return (
    <div className="grid gap-2">
      <CodeBlock data-testid="diff-block" className="bg-card">
        <CodeBlockHeader className="pb-1">
          <CodeBlockTitle className="font-mono text-xs">
            <FileCodeIcon />
            {file.path}
          </CodeBlockTitle>
          <span className="font-mono text-xs tabular-nums">
            <span className="text-success">+{stat.added}</span>{' '}
            <span className="text-destructive">−{stat.removed}</span>
          </span>
          <CodeBlockActions className="ms-0">
            <CodeBlockCopyButton value={file.after} />
          </CodeBlockActions>
        </CodeBlockHeader>
        <CodeBlockContent className="text-xs">
          {rows.map((row, i) =>
            row.type === 'hunk' ? (
              <CodeBlockLine key={i} className="text-muted-foreground/70">
                {row.text}
              </CodeBlockLine>
            ) : (
              <CodeBlockLine
                key={i}
                variant={row.type === 'context' ? 'default' : row.type}
                data-testid={row.type === 'context' ? undefined : `diff-${row.type}`}
              >
                {row.text || ' '}
              </CodeBlockLine>
            ),
          )}
        </CodeBlockContent>
      </CodeBlock>
      <p className="text-muted-foreground text-sm leading-relaxed">{file.rationale}</p>
    </div>
  );
}
