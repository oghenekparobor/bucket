/** CLI: run one background job once (`pnpm catalog:sync`, `prices:sync`, `perf:run`, `leaderboard:run`). */
import { createPool } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { runJobByName } from '../src/jobs/registry.js';

const name = process.argv[2] ?? '';
const db = createPool();
try {
  await migrate(db);
  const result = await runJobByName(db, name);
  console.log(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await db.end();
}
