import { CodeBlock, CodeBlockContent, CodeBlockLine } from '@/components/ui/code-block';

const MAX_LINES = 40;

export function toDisplayText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2) ?? 'null';
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const lines = toDisplayText(value).split('\n');
  const shown = lines.slice(0, MAX_LINES);
  return (
    <div className="grid gap-1">
      <span className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</span>
      <CodeBlock size="sm" className="bg-background">
        <CodeBlockContent className="max-h-56 text-[11px]">
          {shown.map((line, i) => (
            <CodeBlockLine key={i}>{line}</CodeBlockLine>
          ))}
          {lines.length > MAX_LINES && (
            <CodeBlockLine className="text-muted-foreground">
              … {lines.length - MAX_LINES} more lines
            </CodeBlockLine>
          )}
        </CodeBlockContent>
      </CodeBlock>
    </div>
  );
}
