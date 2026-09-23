import { migrate } from '../../src/db/migrate.js';
import { createPool, type Db } from '../../src/db/pool.js';

/** A pool on the test database, reset to an empty, fully migrated schema. */
export async function freshDb(): Promise<Db> {
  const db = createPool(process.env.DATABASE_URL, 5);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(db);
  return db;
}
