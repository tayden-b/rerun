import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLAST_RADIUS_INSTRUCTIONS,
  CONFIG_FIXABLE_INSTRUCTIONS,
  NEEDS_HUMAN_INSTRUCTIONS,
  TRIAGE_QUESTIONS,
} from '../../src/decisions/questions';
import { SCENARIOS_DIR } from '../../src/decisions/recorded';

const SCENARIOS = readdirSync(SCENARIOS_DIR).sort();

/** Paths the fixture scenarios fix or protect, e.g. `main.tf`, `modules/naming/main.tf`. */
const FIXTURE_PATHS = [
  ...new Set(
    SCENARIOS.flatMap((s) => {
      const e = JSON.parse(readFileSync(path.join(SCENARIOS_DIR, s, 'expected.json'), 'utf8')) as {
        fixTouches: string[];
        mustNotTouch: string[];
      };
      return [...e.fixTouches, ...e.mustNotTouch];
    }),
  ),
];

const CALIBRATED = {
  config_fixable: CONFIG_FIXABLE_INSTRUCTIONS,
  needs_human: NEEDS_HUMAN_INSTRUCTIONS,
  blast_radius: BLAST_RADIUS_INSTRUCTIONS,
};

describe('triage questions', () => {
  it('keeps the four SPEC §4 questions and their types', () => {
    expect(Object.keys(TRIAGE_QUESTIONS)).toEqual([
      'failure_class',
      'config_fixable',
      'blast_radius',
      'needs_human',
    ]);
    expect(Object.values(TRIAGE_QUESTIONS).map((q) => q.type)).toEqual(['choice', 'noul', 'score', 'noul']);
    expect(TRIAGE_QUESTIONS.config_fixable.instructions).toBe(CONFIG_FIXABLE_INSTRUCTIONS);
    expect(TRIAGE_QUESTIONS.needs_human.instructions).toBe(NEEDS_HUMAN_INSTRUCTIONS);
    expect(TRIAGE_QUESTIONS.blast_radius.instructions).toBe(BLAST_RADIUS_INSTRUCTIONS);
  });

  it.each(Object.entries(CALIBRATED))('%s instructions name no fixture scenario or path', (_, text) => {
    expect(SCENARIOS).toHaveLength(11);
    const lower = text.toLowerCase();
    for (const name of SCENARIOS) {
      expect(lower).not.toContain(name);
      expect(lower).not.toContain(name.replaceAll('-', ' '));
    }
    for (const p of FIXTURE_PATHS) expect(text).not.toContain(p);
  });

  it('grounds config_fixable in what a reviewed .tf/.tfvars change can and cannot do', () => {
    expect(CONFIG_FIXABLE_INSTRUCTIONS).toMatch(/\.tf and \.tfvars/);
    expect(CONFIG_FIXABLE_INSTRUCTIONS).toMatch(/defaults/);
    expect(CONFIG_FIXABLE_INSTRUCTIONS).toMatch(/version constraints/);
    expect(CONFIG_FIXABLE_INSTRUCTIONS).toMatch(/module sources/);
    expect(CONFIG_FIXABLE_INSTRUCTIONS).toMatch(/credentials or secret values, quota/);
  });

  it('asks needs_human about information a person must supply, not about review', () => {
    expect(NEEDS_HUMAN_INSTRUCTIONS).toMatch(/cannot be derived from the repository, run logs, plan, state/);
    expect(NEEDS_HUMAN_INSTRUCTIONS).toMatch(/must approve before it merges/);
    expect(NEEDS_HUMAN_INSTRUCTIONS).not.toMatch(/more than one reasonable fix/);
    for (const yes of ['credentials or secret values', 'stateful data', 'changes outside Terraform']) {
      expect(NEEDS_HUMAN_INSTRUCTIONS).toContain(yes);
    }
  });
});
