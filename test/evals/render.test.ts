import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CALLED_MCP_TOOLS,
  renderBadges,
  renderMarkdown,
  renderMcpTools,
  replaceSection,
} from '../../evals/report';
import { evalResultsSchema, type EvalResults } from '../../evals/schema';
import { ALLOWED_TOOLS } from '../../src/mcp/allowlist';

const baseline = evalResultsSchema.parse(
  JSON.parse(readFileSync('evals/baselines/questions-v1.json', 'utf8')),
);

/** The baseline with every route answered correctly, as a re-recording after the rewording would. */
function rerecorded(): EvalResults {
  const r = structuredClone(baseline);
  r.generatedAt = '2026-11-22T00:00:00.000Z';
  for (const p of r.providers) {
    for (const s of p.scenarios) {
      if (s.predicted) s.predicted.route = s.expected.route;
      s.routeCorrect = true;
    }
  }
  return r;
}

describe('renderMcpTools', () => {
  const rows = renderMcpTools()
    .split('\n')
    .slice(2)
    .map((line) => line.split('|')[1].trim().replaceAll('`', ''));

  it('has one row per allowlisted tool, in allowlist order', () => {
    expect(rows).toEqual([...ALLOWED_TOOLS]);
  });

  it('matches the --tools list the MCP server is started with', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    const tools = /--tools=([a-z_,]+)/.exec(compose)?.[1].split(',');
    expect(tools).toEqual(rows);
  });

  it('counts only tools with a caller as used', () => {
    expect(CALLED_MCP_TOOLS).toContain('get_plan_json_output');
    expect(CALLED_MCP_TOOLS).not.toContain('get_run_comments');
  });
});

describe('renderMarkdown', () => {
  it('renders accuracy per class with one column per provider', () => {
    const md = renderMarkdown(baseline);
    expect(md).toContain('### Accuracy per failure class');
    expect(md).toContain('| Class | Scenarios | recorded |');
    expect(md).toMatch(/\| `missing_input` \| 1 \| 1\/1 \|/);
    expect(md).toMatch(/\| `config_syntax` \| 2 \| 2\/2 \|/);
  });

  it('renders calibration bins, flip rate and cost per incident', () => {
    const md = renderMarkdown(baseline);
    expect(md).toContain('### Calibration');
    expect(md).toContain('| Bin |');
    expect(md).toContain('Flip rate');
    expect(md).toContain('Triage cost / incident');
  });

  it('renders the rewording table only when given a baseline', () => {
    expect(renderMarkdown(baseline)).not.toContain('Question rewording');
    const md = renderMarkdown(rerecorded(), { baseline });
    expect(md).toContain('### Question rewording: before and after');
    expect(md).toMatch(/Route matches expected[ |]+3\/11 \| 11\/11 \|/);
    expect(md).toMatch(/\| `missing-required-arg` \| `autoPr` \|/);
  });

  it('skips the rewording table when a replay produced the same answers', () => {
    const replay = structuredClone(baseline);
    replay.generatedAt = '2026-11-22T00:00:00.000Z';
    expect(renderMarkdown(replay, { baseline })).not.toContain('Question rewording');
  });

  it('scores the rewording on the scenarios both runs share', () => {
    const subset = rerecorded();
    for (const p of subset.providers)
      p.scenarios = p.scenarios.filter(
        (s) => s.scenario === 'removed-argument' || s.scenario === 'unset-variable',
      );
    expect(renderMarkdown(subset, { baseline })).toMatch(/Route matches expected[ |]+1\/2 \| 2\/2 \|/);
  });

  it('renders one live row per scenario with verifier and PR link', () => {
    const r = structuredClone(baseline);
    r.live = {
      ran: true,
      rows: [
        {
          scenario: 'unset-variable',
          reachedStatus: 'awaiting_approval',
          verifierOk: true,
          prUrl: 'https://github.com/tayden-b/rerun-fixtures/pull/99',
          fixTouchesRespected: true,
          durationMs: 184_000,
        },
        {
          scenario: 'bad-http-url',
          reachedStatus: 'needs_human',
          verifierOk: false,
          prUrl: null,
          fixTouchesRespected: null,
          durationMs: 92_000,
        },
      ],
    };
    const md = renderMarkdown(r);
    expect(md).toContain('1 of 2 reached a passing verifier and an open PR.');
    expect(md).toContain('https://github.com/tayden-b/rerun-fixtures/pull/99');
    expect(md).toMatch(/\| `?unset-variable`? \|/);
  });
});

describe('renderBadges', () => {
  it('writes shields.io endpoint JSON for the eval and the MCP tool count', () => {
    const badges = renderBadges(baseline);
    expect(badges['eval.json']).toEqual({
      schemaVersion: 1,
      label: 'triage eval',
      message: 'class 11/11 · route 3/11',
      color: '3b82f6',
    });
    expect(badges['mcp-tools.json'].message).toBe(
      `${CALLED_MCP_TOOLS.length} tools used, ${ALLOWED_TOOLS.length} allowed`,
    );
  });
});

describe('replaceSection', () => {
  it('replaces a named section and leaves the evals markers alone', () => {
    const readme =
      '<!-- mcp-tools:start -->\nold\n<!-- mcp-tools:end -->\n<!-- evals:start -->\nkeep\n<!-- evals:end -->\n';
    expect(replaceSection(readme, 'mcp-tools', 'new')).toBe(
      '<!-- mcp-tools:start -->\n\nnew\n\n<!-- mcp-tools:end -->\n<!-- evals:start -->\nkeep\n<!-- evals:end -->\n',
    );
  });

  it('names the missing marker', () => {
    expect(() => replaceSection('# Rerun\n', 'mcp-tools', 'x')).toThrow(/mcp-tools:start/);
  });
});
