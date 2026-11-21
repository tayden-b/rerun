'use client';

import { CheckIcon, CircleXIcon, TerminalIcon } from 'lucide-react';
import { CodeBlock, CodeBlockContent, CodeBlockLine } from '@/components/ui/code-block';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace';
import { formatDuration } from '@/lib/ui/time';
import type { StepOutput, VerifyResult } from '@/src/shared/types';

const COMMANDS: { key: 'fmt' | 'validate' | 'plan'; command: string }[] = [
  { key: 'fmt', command: 'terraform fmt -check -recursive' },
  { key: 'validate', command: 'terraform validate' },
  { key: 'plan', command: 'terraform plan (speculative)' },
];

function outputLines(output: StepOutput): string[] {
  const text = [output.stdout, output.stderr].filter(Boolean).join('\n').trimEnd();
  return text ? text.split('\n') : [];
}

export function Verification({ verify }: { verify: VerifyResult }) {
  const totalMs = COMMANDS.reduce((sum, c) => sum + verify[c.key].durationMs, 0);
  return (
    <Trace data-testid="terminal">
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine status={verify.ok ? undefined : 'error'}>
            <TraceIcon>
              <TerminalIcon />
            </TraceIcon>
            <TraceTitle className="text-foreground">{verify.summary}</TraceTitle>
            <TraceDescription className="text-xs">{formatDuration(totalMs)}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="ml-0 border-l-0 pl-0">
          <CodeBlock size="sm" className="bg-background">
            <CodeBlockContent className="max-h-80 text-xs" data-testid="terminal-output">
              {COMMANDS.flatMap(({ key, command }) => {
                const output = verify[key];
                return [
                  <CodeBlockLine key={`${key}-cmd`} className="text-foreground">
                    <span className="text-muted-foreground select-none">$ </span>
                    {command}
                    <span className={output.ok ? 'text-success' : 'text-destructive'}>
                      {' '}
                      {output.ok ? (
                        <CheckIcon className="inline size-3" />
                      ) : (
                        <CircleXIcon className="inline size-3" />
                      )}
                    </span>
                    <span className="text-muted-foreground"> exit {output.exitCode}</span>
                  </CodeBlockLine>,
                  ...outputLines(output).map((line, i) => (
                    <CodeBlockLine key={`${key}-${i}`} className="text-muted-foreground">
                      {line || ' '}
                    </CodeBlockLine>
                  )),
                  <CodeBlockLine key={`${key}-gap`}> </CodeBlockLine>,
                ];
              })}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
