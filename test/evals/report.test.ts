import { describe, expect, it } from 'vitest';
import { replaceEvalsSection, README_END, README_START } from '../../evals/report';

const readme = `# Rerun\n\nIntro.\n\n## Evals\n\n${README_START}\n\nold table\n\n${README_END}\n\n## After\n\nKeep me.\n`;

describe('replaceEvalsSection', () => {
  it('replaces only the marked section', () => {
    expect(replaceEvalsSection(readme, '| a |\n| - |\n| 1 |\n')).toMatchInlineSnapshot(`
      "# Rerun

      Intro.

      ## Evals

      <!-- evals:start -->

      | a |
      | - |
      | 1 |

      <!-- evals:end -->

      ## After

      Keep me.
      "
    `);
  });

  it('is idempotent', () => {
    const once = replaceEvalsSection(readme, 'body');
    expect(replaceEvalsSection(once, 'body')).toBe(once);
  });

  it('throws without markers', () => {
    expect(() => replaceEvalsSection('# Rerun\n', 'body')).toThrow(/evals:start/);
  });
});
