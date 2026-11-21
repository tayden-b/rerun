import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    '.next/**',
    '.next-*/**',
    '.workflow-data/**',
    'data/**',
    'out/**',
    'build/**',
    'drizzle/**',
    'next-env.d.ts',
    'app/.well-known/workflow/**',
  ]),
]);

export default eslintConfig;
