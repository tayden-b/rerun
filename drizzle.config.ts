import { defineConfig } from 'drizzle-kit';
import './scripts/load-env';

export default defineConfig({
  dialect: 'turso',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'file:data/rerun.db' },
});
