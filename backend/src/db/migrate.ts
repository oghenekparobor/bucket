import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrationsDir } from '../paths.js';
import { createPool, type Db } from './pool.js';

/** Session advisory lock so the API, worker and keeper can start together without racing. */
const MIGRATION_LOCK = 72_010_421;

/**
 * Tiny forward-only migration runner: applies every `migrations/NNN_*.sql` file not yet recorded in
 * `schema_migrations`, each in its own transaction, in filename order, under an advisory lock.
 */
export async function migrate(db: Db, log: (msg: string) => void = () => undefined): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = readdirSync(migrationsDir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      try {
        await client.query('BEGIN');
        await client.query(readFileSync(join(migrationsDir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return applied;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const db = createPool();
  migrate(db, console.log)
    .then((applied) => console.log(applied.length ? `migrations applied: ${applied.length}` : 'database up to date'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.end());
}
