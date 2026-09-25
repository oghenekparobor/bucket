// Cron mode runs whatever is due and nothing else, so a scheduler firing every minute behaves like
// the worker: the catalog once an hour, prices every five minutes, the indexer every time.
import { describe, expect, it } from 'vitest';
import { JOBS } from '../src/jobs/registry.js';
import { SCHEDULE } from '../src/jobs/schedule.js';
import { dueJobs } from '../src/jobs/tick.js';

const now = new Date('2026-09-25T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const names = (js: { name: string }[]) => js.map((j) => j.name);

describe('dueJobs', () => {
  it('runs everything on a database that has never seen a job', () => {
    expect(names(dueJobs(SCHEDULE, new Map(), now))).toEqual(names(SCHEDULE));
  });

  it('runs only what its interval says is due', () => {
    const lastOk = new Map<string, Date>([
      ['catalog', ago(30 * 60_000)], // hourly: not due
      ['prices', ago(6 * 60_000)], // every 5 min: due
      ['indexer', ago(1_000)], // every 3 s: not due one second later
      ['performance', ago(10 * 60_000)], // exactly on the boundary: due
    ]);
    const due = names(dueJobs(SCHEDULE, lastOk, now));
    expect(due).toContain('prices');
    expect(due).toContain('performance');
    expect(due).not.toContain('catalog');
    expect(due).not.toContain('indexer');
    expect(due).toContain('leaderboard'); // never ran
  });

  it('force runs everything, only narrows the field', () => {
    const lastOk = new Map<string, Date>(SCHEDULE.map((j) => [j.name, now]));
    expect(names(dueJobs(SCHEDULE, lastOk, now))).toEqual([]);
    expect(names(dueJobs(SCHEDULE, lastOk, now, { force: true }))).toEqual(names(SCHEDULE));
    expect(names(dueJobs(SCHEDULE, new Map(), now, { only: ['prices', 'nope'] }))).toEqual(['prices']);
  });

  it('names only registered jobs, so cron mode cannot silently drop one', () => {
    for (const j of SCHEDULE) {
      expect(j.everyMs).toBeGreaterThan(0);
      expect(Object.keys(JOBS), `${j.name} is scheduled but not registered`).toContain(j.name);
    }
  });
});
