import { describe, expect, it } from 'vitest';
import { buildTriageState, changedFilesOf, runStatusOf, summarizePlan } from '../../src/agents/triage';
import { sampleContext } from './fixtures';

describe('buildTriageState', () => {
  it('builds the SPEC §4 state from the artifacts', () => {
    expect(buildTriageState(sampleContext())).toEqual({
      runStatus: 'errored',
      stage: 'apply',
      errorExcerpt: sampleContext().artifacts.errorExcerpt,
      planSummary: {
        total: 4,
        counts: { create: 1, 'no-op': 1, replace: 1, delete: 1 },
        changes: [
          { address: 'terraform_data.bootstrap', action: 'create' },
          { address: 'tls_private_key.ca', action: 'replace' },
          { address: 'null_resource.old', action: 'delete' },
        ],
        omitted: 0,
      },
      changedFiles: [],
    });
  });

  it('has no planSummary when no plan exists', () => {
    expect(buildTriageState(sampleContext({ planJson: undefined, stage: 'init' })).planSummary).toBeNull();
  });

  it('redacts secrets in the excerpt', () => {
    const ctx = sampleContext({ errorExcerpt: 'Error: auth failed with Bearer abcdefghijklmnop1234' });
    expect(buildTriageState(ctx).errorExcerpt).toBe('Error: auth failed with Bearer [REDACTED:bearer]');
  });
});

describe('summarizePlan', () => {
  it('caps addresses at 30 and counts the rest', () => {
    const rc = Array.from({ length: 45 }, (_, i) => ({
      address: `null_resource.r${i}`,
      change: { actions: ['update'] },
    }));
    const s = summarizePlan({ resource_changes: rc });
    expect(s?.changes).toHaveLength(30);
    expect(s?.omitted).toBe(15);
    expect(s?.counts).toEqual({ update: 45 });
  });

  it('accepts MCP JSON text', () => {
    const text = JSON.stringify({ resource_changes: [{ address: 'a.b', change: { actions: ['create'] } }] });
    expect(summarizePlan(text)?.counts).toEqual({ create: 1 });
  });
});

describe('run fields', () => {
  it('reads the status from fixture, JSON:API and plain shapes', () => {
    expect(runStatusOf({ result: { attributes: { status: 'errored' } } })).toBe('errored');
    expect(runStatusOf({ data: { attributes: { status: 'planned_and_finished' } } })).toBe(
      'planned_and_finished',
    );
    expect(runStatusOf(JSON.stringify({ status: 'errored' }))).toBe('errored');
    expect(runStatusOf(undefined)).toBe('unknown');
  });

  it('reads changed files from the configuration version when present', () => {
    const run = {
      data: { attributes: { status: 'errored' } },
      included: [
        { type: 'configuration-versions', attributes: { 'changed-files': ['main.tf', 'variables.tf'] } },
      ],
    };
    expect(changedFilesOf(run)).toEqual(['main.tf', 'variables.tf']);
    expect(changedFilesOf(sampleContext().artifacts.run)).toEqual([]);
  });
});
