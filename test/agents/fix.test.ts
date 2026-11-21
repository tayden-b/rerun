import { describe, expect, it } from 'vitest';
import { clampTitle, NoChangeError, runFix } from '../../src/agents/fix';
import type { Diagnosis, VerifyResult } from '../../src/shared/types';
import { answer, fakeContext, fakeDeps, scriptedModel, toolCalls, UNDECLARED_REFERENCE_FILES } from './fakes';

const diagnosis: Diagnosis = {
  agent: 'config',
  rootCause: 'outputs.tf line 6 references the undeclared random_pet.servce.',
  evidence: [{ kind: 'file', ref: 'outputs.tf:6', excerpt: 'random_pet.servce.id' }],
  suggestedChange: 'Change random_pet.servce.id to random_pet.service.id.',
  confidence: 0.95,
  steps: 2,
};

const fixedOutputs = UNDECLARED_REFERENCE_FILES['outputs.tf'].replace('servce', 'service');
const rationale = 'Point service_url at the declared random_pet.service resource.';

describe('runFix', () => {
  it('turns read_file + write_file into a one-file Patch with rationale', async () => {
    const { model } = scriptedModel({
      Fix: [
        toolCalls({ toolName: 'read_file', input: { path: 'outputs.tf' } }),
        toolCalls({
          toolName: 'write_file',
          input: { path: 'outputs.tf', content: fixedOutputs, rationale },
        }),
        answer({
          title: 'Fix undeclared reference to random_pet.service in outputs.tf',
          summary: 'Typo fix.',
        }),
      ],
    });
    const deps = fakeDeps({ model });
    const patch = await runFix(fakeContext(), [diagnosis], deps);

    expect(patch).toEqual({
      title: 'Fix undeclared reference to random_pet.service in outputs.tf',
      summary: 'Typo fix.',
      files: [
        {
          path: 'outputs.tf',
          before: UNDECLARED_REFERENCE_FILES['outputs.tf'],
          after: fixedOutputs,
          rationale,
        },
      ],
    });
    const kinds = deps.events.map((e) => `${e.step}:${e.kind}`);
    expect(new Set(deps.events.map((e) => e.step))).toEqual(new Set(['fix']));
    expect(kinds.filter((k) => k === 'fix:tool_call')).toHaveLength(2);
    expect(deps.events.at(-1)?.payload).toMatchObject({ done: true, steps: 3 });
  });

  it('throws NoChangeError when the agent edits nothing', async () => {
    const { model } = scriptedModel({
      Fix: [
        toolCalls({ toolName: 'read_file', input: { path: 'outputs.tf' } }),
        answer({ title: 'Nothing', summary: 'Needs a credential, not a config change.' }),
      ],
    });
    await expect(runFix(fakeContext(), [diagnosis], fakeDeps({ model }))).rejects.toBeInstanceOf(
      NoChangeError,
    );
  });

  it('a refused write leaves no patch', async () => {
    const { model } = scriptedModel({
      Fix: [
        toolCalls({
          toolName: 'write_file',
          input: { path: 'versions.tf', content: 'terraform {}\n', rationale },
        }),
        answer({ title: 'Edit versions', summary: 's' }),
      ],
    });
    const deps = fakeDeps({ model, files: { ...UNDECLARED_REFERENCE_FILES, 'versions.tf': 'x\n' } });
    await expect(runFix(fakeContext(), [diagnosis], deps)).rejects.toBeInstanceOf(NoChangeError);
    const result = deps.events.find((e) => e.kind === 'tool_result');
    expect(JSON.stringify(result?.payload)).toContain('REFUSED');
  });

  it('retries from the previous patch with the verifier output in the brief', async () => {
    const step = (ok: boolean, stderr = '') => ({
      ok,
      exitCode: ok ? 0 : 1,
      stdout: '',
      stderr,
      durationMs: 1,
    });
    const verify: VerifyResult = {
      ok: false,
      fmt: step(false, 'outputs.tf'),
      validate: step(true),
      plan: step(true),
      summary: 'terraform fmt -check failed',
    };
    const firstTry = UNDECLARED_REFERENCE_FILES['outputs.tf']
      .replace('servce', 'service')
      .replace('  value', '    value');
    const { model, seen } = scriptedModel({
      Fix: [
        toolCalls({
          toolName: 'write_file',
          input: { path: 'outputs.tf', content: fixedOutputs, rationale },
        }),
        answer({ title: 'Fix reference and formatting in outputs.tf', summary: 's' }),
      ],
    });
    const patch = await runFix(fakeContext(), [diagnosis], fakeDeps({ model }), verify, [
      { path: 'outputs.tf', before: UNDECLARED_REFERENCE_FILES['outputs.tf'], after: firstTry, rationale },
    ]);
    expect(patch.files).toEqual([
      {
        path: 'outputs.tf',
        before: UNDECLARED_REFERENCE_FILES['outputs.tf'],
        after: fixedOutputs,
        rationale,
      },
    ]);
    const user = JSON.stringify(seen[0].prompt.find((m) => m.role === 'user'));
    expect(user).toContain('terraform fmt -check failed');
    expect(user).toContain('terraform fmt (exit 1)');
  });
});

describe('clampTitle', () => {
  it('keeps titles at or under 70 characters on a word boundary', () => {
    const long =
      'Fix the undeclared reference to random_pet.service in the outputs file of the fixtures repo';
    const t = clampTitle(long);
    expect(t.length).toBeLessThanOrEqual(70);
    expect(long.startsWith(t)).toBe(true);
    expect(clampTitle('  Fix\n typo ')).toBe('Fix typo');
  });
});
