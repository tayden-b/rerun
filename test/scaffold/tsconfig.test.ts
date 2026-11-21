import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMO_ENV } from '../../playwright.config';

// `next dev`/`next build` with NEXT_DIST_DIR=<dir> rewrites tsconfig.json unless both type globs are already
// included, which leaves the tree dirty and fails `npm run lint` after `npm run test:e2e`.
const tsconfig = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'tsconfig.json'), 'utf8')) as {
  include: string[];
};

describe('tsconfig.json', () => {
  it.each(['.next', '.next-test', DEMO_ENV.NEXT_DIST_DIR])(
    'already includes the Next type globs for %s',
    (dir) => {
      expect(tsconfig.include).toEqual(
        expect.arrayContaining([`${dir}/types/**/*.ts`, `${dir}/dev/types/**/*.ts`]),
      );
    },
  );
});
