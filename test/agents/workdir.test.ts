import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatch, materializeRepo, normalizeRepoPath } from '../../src/agents/workdir';

describe('materializeRepo', () => {
  it('writes the files to a temp dir and diffs exactly the changed paths', async () => {
    const wd = await materializeRepo({
      files: { 'main.tf': 'a\n', 'outputs.tf': 'b\n', 'modules/x/main.tf': 'c\n' },
    });
    try {
      expect(readFileSync(path.join(wd.dir, 'modules/x/main.tf'), 'utf8')).toBe('c\n');
      expect(wd.list()).toEqual(['main.tf', 'modules/x/main.tf', 'outputs.tf']);
      expect(wd.diff()).toEqual([]);

      await wd.write('outputs.tf', 'B\n', 'Fix the output.');
      await wd.write('./new.tf', 'n\n', 'Add a file.');
      await wd.write('main.tf', 'a\n');

      expect(wd.diff()).toEqual([
        { path: 'new.tf', before: null, after: 'n\n', rationale: 'Add a file.' },
        { path: 'outputs.tf', before: 'b\n', after: 'B\n', rationale: 'Fix the output.' },
      ]);
      expect(readFileSync(path.join(wd.dir, 'outputs.tf'), 'utf8')).toBe('B\n');
      expect(wd.read('outputs.tf')).toBe('B\n');
    } finally {
      await wd.cleanup();
    }
    expect(existsSync(wd.dir)).toBe(false);
  });

  it('drops a file from the diff when it is written back to its original content', async () => {
    const wd = await materializeRepo({ files: { 'main.tf': 'a\n' } });
    await wd.write('main.tf', 'x\n', 'r');
    await wd.write('main.tf', 'a\n', 'r');
    expect(wd.diff()).toEqual([]);
    await wd.cleanup();
  });

  it('replays a previous patch while diffing against the original files', async () => {
    const files = { 'main.tf': 'a\n', 'outputs.tf': 'b\n' };
    const wd = await materializeRepo({
      files,
      apply: [{ path: 'outputs.tf', before: 'b\n', after: 'B\n', rationale: 'first try' }],
    });
    expect(wd.read('outputs.tf')).toBe('B\n');
    expect(wd.diff().map((f) => [f.path, f.before, f.after])).toEqual([['outputs.tf', 'b\n', 'B\n']]);
    expect(applyPatch(files, { files: wd.diff() })).toEqual({ 'main.tf': 'a\n', 'outputs.tf': 'B\n' });
    await wd.cleanup();
  });

  it('rejects paths that escape the working copy', async () => {
    expect(() => normalizeRepoPath('../etc/passwd')).toThrow(/outside/);
    expect(() => normalizeRepoPath('/etc/passwd')).toThrow(/outside/);
    expect(normalizeRepoPath('a/../b.tf')).toBe('b.tf');
    const wd = await materializeRepo({ files: {} });
    await expect(wd.write('../x.tf', '')).rejects.toThrow(/outside/);
    await wd.cleanup();
  });

  it('rolls back a write that fails on disk so it never reaches the patch', async () => {
    const wd = await materializeRepo({ files: { 'main.tf': 'a\n' } });
    await expect(wd.write('main.tf/child.tf', 'x\n', 'r')).rejects.toThrow();
    expect(wd.read('main.tf/child.tf')).toBeUndefined();
    expect(wd.diff()).toEqual([]);
    await wd.cleanup();
  });
});
