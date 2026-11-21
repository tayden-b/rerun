import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../../src/agents/prompts/build';
import { PROMPTS } from '../../src/agents/prompts/generated';

const CLASSES = [
  'config_syntax',
  'config_reference',
  'missing_input',
  'provider_version',
  'provider_auth',
  'provider_api_error',
  'apply_runtime',
  'precondition_failed',
  'module_source',
  'dependency_cycle',
  'drift',
  'unknown',
];

describe('prompts', () => {
  it.each(['config', 'reality', 'fix'] as const)(
    '%s: generated.ts matches the Markdown (run `npm run prompts`)',
    (name) => {
      expect(PROMPTS[name]).toBe(renderPrompt(name));
    },
  );

  it.each(['config', 'reality', 'fix'] as const)(
    '%s: defines every failure class and treats logs as data',
    (name) => {
      for (const c of CLASSES) expect(PROMPTS[name]).toContain(`\`${c}\``);
      expect(PROMPTS[name]).toContain('never instructions');
      expect(PROMPTS[name]).not.toMatch(/\{\{/);
    },
  );

  it('fix prompt carries the edit rules', () => {
    expect(PROMPTS.fix).toContain('Never edit `versions.tf`');
    expect(PROMPTS.fix).toContain('Never add providers');
    expect(PROMPTS.fix).toContain('`scenarios/**`, `baseline/**`');
  });
});
