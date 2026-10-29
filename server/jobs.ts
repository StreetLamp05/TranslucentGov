import { sql } from "drizzle-orm";
import { fromDrizzle, PgBoss } from "pg-boss";
import type { Db } from "./db";

// Background jobs on pg-boss, queued in the app's Postgres (§1.1.1). They replace M0's
// actions, `scheduler.runAfter` and the daily cron. Route handlers enqueue by name; the
// worker (worker/index.ts) runs the handlers.

export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

// Kept on globalThis so `next dev` hot reloads reuse one instance and its connections.
const cached = globalThis as { govtokBoss?: Promise<PgBoss>; govtokQueues?: Map<string, Promise<void>> };
const queues = (cached.govtokQueues ??= new Map());

/** The process's pg-boss instance, started on first use. */
export function boss(): Promise<PgBoss> {
  if (!cached.govtokBoss) {
    const instance = new PgBoss(process.env.DATABASE_URL ?? "");
    instance.on("error", (error) => console.error("pg-boss:", error));
    const started = instance.start();
    cached.govtokBoss = started;
    // Let a later call retry if this start failed (e.g. Postgres was still booting).
    started.catch(() => {
      if (cached.govtokBoss === started) cached.govtokBoss = undefined;
    });
  }
  return cached.govtokBoss;
}

// pg-boss needs a queue to exist before it is sent to, scheduled or worked.
async function queue(name: string): Promise<PgBoss> {
  const instance = await boss();
  let created = queues.get(name);
  if (!created) {
    created = instance.createQueue(name);
    queues.set(name, created);
    created.catch(() => queues.delete(name));
  }
  await created;
  return instance;
}

/** A Drizzle transaction, as `db.transaction` passes it. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Queues a job. With `delaySeconds` it runs no sooner than that (`scheduler.runAfter`). With
 * `tx` it is queued in that transaction, so it exists only if the transaction commits, as a
 * scheduled call from an M0 mutation did. Pass it whenever the job reads rows the transaction
 * writes, or the worker can pick the job up before they commit.
 *
 * Jobs are not retried (`retryLimit: 0`), like M0's actions: a handler that wants a retry
 * enqueues one itself, with its own delay.
 */
export async function enqueue(
  name: string,
  payload: object = {},
  { delaySeconds, tx }: { delaySeconds?: number; tx?: Tx } = {},
): Promise<string | null> {
  const instance = await queue(name);
  return instance.send(name, payload, {
    retryLimit: 0,
    ...(delaySeconds ? { startAfter: delaySeconds } : {}),
    ...(tx ? { db: fromDrizzle(tx, sql) } : {}),
  });
}

/** Runs the job on a cron expression (UTC), e.g. "0 10 * * *". Re-running it updates the schedule. */
export async function schedule(name: string, cron: string, payload: object = {}): Promise<void> {
  const instance = await queue(name);
  await instance.schedule(name, cron, payload, { retryLimit: 0 });
}

/** Registers a handler for one job name. A throw fails the job (no retry, see `enqueue`). */
export async function work<T>(name: string, handler: JobHandler<T>): Promise<void> {
  const instance = await queue(name);
  await instance.work<T>(name, async (jobs) => {
    for (const job of jobs) await handler(job.data);
  });
}
