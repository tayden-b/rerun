import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { renderBadges, renderMarkdown, renderMcpTools, replaceSection } from './report';
import { evalResultsSchema, type EvalResults } from './schema';

// `npm run eval:readme`: renders the generated README sections (evals, MCP tool table) and the
// shields.io endpoint badges. Text outside the markers is left byte-for-byte.
const { values } = parseArgs({
  options: {
    results: { type: 'string', default: 'evals/results.json' },
    baseline: { type: 'string', default: 'evals/baselines/questions-v1.json' },
    readme: { type: 'string', default: 'README.md' },
    badges: { type: 'string', default: 'docs/badges' },
  },
});

const load = (file: string): EvalResults =>
  evalResultsSchema.parse(JSON.parse(readFileSync(path.resolve(file), 'utf8')));

async function main(): Promise<number> {
  const readmePath = path.resolve(values.readme);
  const results = load(values.results);
  const baseline = existsSync(path.resolve(values.baseline)) ? load(values.baseline) : undefined;
  const options = { ...(await resolveConfig(readmePath)), parser: 'markdown' };
  const md = async (body: string) => format(body, options);

  let readme = readFileSync(readmePath, 'utf8');
  readme = replaceSection(readme, 'evals', await md(renderMarkdown(results, { baseline })));
  readme = replaceSection(readme, 'mcp-tools', await md(renderMcpTools()));
  writeFileSync(readmePath, readme);

  const badgesDir = path.resolve(values.badges);
  mkdirSync(badgesDir, { recursive: true });
  for (const [name, badge] of Object.entries(renderBadges(results))) {
    writeFileSync(path.join(badgesDir, name), `${JSON.stringify(badge, null, 2)}\n`);
  }
  console.log(
    `Updated ${path.relative(process.cwd(), readmePath)} and ${path.relative(process.cwd(), badgesDir)}/`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
