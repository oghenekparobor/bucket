import pg from 'pg';
import { config } from '../config.js';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;
/** Anything that can run a query: the pool or a checked-out client inside a transaction. */
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString = config.DATABASE_URL, max = 10): Db {
  return new pg.Pool({ connectionString, max });
}

/** Runs `fn` inside a transaction on a dedicated client, rolling back on error. */
export async function withTx<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
