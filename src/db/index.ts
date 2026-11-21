import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { config } from '../config';
import * as schema from './schema';

export type Db = LibSQLDatabase<typeof schema>;

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');

function ensureParentDir(url: string): void {
  if (!url.startsWith('file:') || url.includes(':memory:')) return;
  const file = url.slice('file:'.length).split('?')[0];
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

/** Opens a libSQL database and applies pending migrations from `drizzle/`. */
export async function openDb(url: string = config.databaseUrl): Promise<Db> {
  ensureParentDir(url);
  const client = createClient({ url });
  await client.execute('PRAGMA foreign_keys = ON');
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

const opened = new Map<string, Promise<Db>>();

/** Process-wide, migrated database for `url` (defaults to `DATABASE_URL`). */
export function getDb(url: string = config.databaseUrl): Promise<Db> {
  let db = opened.get(url);
  if (!db) {
    db = openDb(url);
    db.catch(() => opened.delete(url));
    opened.set(url, db);
  }
  return db;
}

export { schema };
