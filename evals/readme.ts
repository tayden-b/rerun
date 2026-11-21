import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { renderMarkdown, replaceEvalsSection } from './report';
import { evalResultsSchema } from './schema';

const { values } = parseArgs({
  options: {
    results: { type: 'string', default: 'evals/results.json' },
    readme: { type: 'string', default: 'README.md' },
  },
});

async function main(): Promise<number> {
  const readmePath = path.resolve(values.readme);
  const results = evalResultsSchema.parse(JSON.parse(readFileSync(path.resolve(values.results), 'utf8')));
  const next = replaceEvalsSection(readFileSync(readmePath, 'utf8'), renderMarkdown(results));
  writeFileSync(
    readmePath,
    await format(next, { ...(await resolveConfig(readmePath)), filepath: readmePath }),
  );
  console.log(`Updated the evals section of ${path.relative(process.cwd(), readmePath)}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
