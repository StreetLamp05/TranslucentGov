import { purgeExpired as purgeBatch } from "../purge";

// The nightly retention job (§7.1.1): held reports, unverified fix attempts and old intake
// videos, with their MinIO objects. Ports convex/crons.ts. Scheduled by worker/index.ts.

export const PURGE_EXPIRED = "purgeExpired";
/** Daily at 10:00 UTC, as M0's cron was. */
export const PURGE_CRON = "0 10 * * *";

// A backlog bigger than one batch is drained by running again; a run that deleted nothing stops,
// so items that keep failing can't loop forever.
const MAX_RUNS = 100;

export async function purgeExpired(): Promise<void> {
  let failures = 0;
  for (let run = 0; run < MAX_RUNS; run++) {
    const result = await purgeBatch();
    failures += result.failures;
    console.log(
      `purgeExpired: ${result.reports} reports, ${result.attempts} fix attempts, ${result.intake} intake videos, ${result.sessions} sessions`,
    );
    if (!result.more || result.reports + result.attempts + result.intake === 0) break;
  }
  // No retry (server/jobs.ts): fail the job so the worker log shows it, and the next night tries again.
  if (failures > 0) throw new Error(`purgeExpired: ${failures} items couldn't be deleted`);
}
