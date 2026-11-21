// Regenerates generated.ts from the Markdown prompts: `npm run prompts`.
// The prompts ship inside the bundle (no runtime file reads), and a test keeps the two in sync.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = path.join(process.cwd(), 'src', 'agents', 'prompts');
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8').trim();

export function renderPrompt(name: 'config' | 'reality' | 'fix'): string {
  return read(`${name}.md`)
    .replace('{{failure_classes}}', read('classes.md'))
    .replace('{{untrusted_data}}', read('safety.md'));
}

export function renderModule(): string {
  const prompts = {
    config: renderPrompt('config'),
    reality: renderPrompt('reality'),
    fix: renderPrompt('fix'),
  };
  return [
    '// Generated from src/agents/prompts/*.md by `npm run prompts`. Do not edit by hand.',
    `export const PROMPTS = ${JSON.stringify(prompts, null, 2)} as const;`,
    '',
  ].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(dir, 'build.ts')) {
  writeFileSync(path.join(dir, 'generated.ts'), renderModule());
}
