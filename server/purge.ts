import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { db } from "./db";
import { fixAttempts, reports, uploads, videoIntake, videoIntakeAdminSessions } from "./db/schema";
import { deleteObject } from "./storage";

// Retention (§7.1.1): held reports and unverified fix attempts are deleted 7 days after they
// were posted, with their MinIO objects. Published reports (open / fixed), samples and verified
// attempts are kept. Intake videos (/admin/video-intake) also go after 7 days, and expired admin
// sessions are cleared. Ports convex/purge.ts and videoIntake.purgeExpired; the nightly job is
// server/jobs/purgeExpired.ts.
export const PURGE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const INTAKE_RETENTION_MS = PURGE_AFTER_MS;

// Deletions per table per run. A full batch means more may be left, so the job runs again.
export const BATCH = 50;

const UNVERIFIED_ATTEMPT_STATUSES = ["checking", "not_fixed", "retake", "failed", "superseded"] as const;

export type PurgeResult = {
  reports: number;
  attempts: number;
  intake: number;
  sessions: number;
  /** A batch filled up, so another run may find more. */
  more: boolean;
  /** Items that couldn't be deleted (MinIO unreachable, say). They're tried again next run. */
  failures: number;
};

/**
 * The upload time of the newest of these keys, or null when none has an `uploads` row (files
 * already gone). Age runs from the newest upload, so a retake (§4.2.1) restarts the 7 days.
 */
async function newestUpload(keys: string[]): Promise<number | null> {
  if (keys.length === 0) return null;
  const rows = await db.select({ createdAt: uploads.createdAt }).from(uploads).where(inArray(uploads.key, keys));
  return rows.length ? Math.max(...rows.map((row) => row.createdAt)) : null;
}

// Objects first, then the row: if MinIO fails the row stays and the next run retries. A key that
// is already gone is not an error (server/storage.ts), so a missing file can't wedge the job.
async function deleteObjects(keys: (string | null)[]): Promise<void> {
  for (const key of keys) if (key) await deleteObject(key);
}

/** Runs one batch of every kind of purge. */
export async function purgeExpired(now = Date.now()): Promise<PurgeResult> {
  const cutoff = now - PURGE_AFTER_MS;
  const result: PurgeResult = { reports: 0, attempts: 0, intake: 0, sessions: 0, more: false, failures: 0 };
  // One bad item shouldn't keep the rest from going: count it, log it, carry on.
  const attempt = async (what: string, run: () => Promise<void>): Promise<boolean> => {
    try {
      await run();
      return true;
    } catch (error) {
      result.failures++;
      console.error(`purge: couldn't delete ${what}:`, error);
      return false;
    }
  };

  // Samples are backdated (§6.1.1) and released by hand for the demo; never purge them.
  const held = await db
    .select()
    .from(reports)
    .where(and(eq(reports.status, "held"), eq(reports.isSample, false), lt(reports.createdAt, cutoff)))
    .orderBy(reports.createdAt);
  // Held reports are walked rather than taken, because skipped ones (a retake restarted the
  // clock) would otherwise fill every batch.
  for (const report of held) {
    if (result.reports === BATCH) {
      result.more = true;
      break;
    }
    // Attempts cascade with the report, so their files go too (a held report rarely has any).
    const attempts = await db.select().from(fixAttempts).where(eq(fixAttempts.reportId, report.id));
    const keys = [
      report.clipStorageId,
      ...report.frameStorageIds,
      ...attempts.flatMap((a) => [a.clipStorageId, ...a.frameStorageIds]),
    ].filter((key): key is string => key !== null);
    const newest = await newestUpload(keys);
    if (newest !== null && newest >= cutoff) continue;

    const purged = await attempt(`report ${report.id}`, async () => {
      await deleteObjects(keys);
      // Me-toos and attempts go with it (ON DELETE CASCADE).
      await db.delete(reports).where(eq(reports.id, report.id));
    });
    if (purged) result.reports++;
  }

  const stale = await db
    .select()
    .from(fixAttempts)
    .where(and(inArray(fixAttempts.status, [...UNVERIFIED_ATTEMPT_STATUSES]), lt(fixAttempts.createdAt, cutoff)))
    .orderBy(fixAttempts.createdAt)
    .limit(BATCH);
  result.more ||= stale.length === BATCH;
  for (const old of stale) {
    const purged = await attempt(`fix attempt ${old.id}`, async () => {
      await deleteObjects([old.clipStorageId, ...old.frameStorageIds]);
      await db.delete(fixAttempts).where(eq(fixAttempts.id, old.id));
    });
    if (purged) result.attempts++;
  }

  const expiredIntake = await db
    .select()
    .from(videoIntake)
    .where(lt(videoIntake.createdAt, now - INTAKE_RETENTION_MS))
    .orderBy(videoIntake.createdAt)
    .limit(BATCH);
  result.more ||= expiredIntake.length === BATCH;
  for (const entry of expiredIntake) {
    const purged = await attempt(`video intake ${entry.id}`, async () => {
      await deleteObjects([entry.storageId]);
      await db.delete(videoIntake).where(eq(videoIntake.id, entry.id));
    });
    if (purged) result.intake++;
  }

  // Sessions are never read once expired (server/auth.ts), so this is housekeeping.
  const sessions = await db
    .delete(videoIntakeAdminSessions)
    .where(lte(videoIntakeAdminSessions.expiresAt, now))
    .returning({ id: videoIntakeAdminSessions.id });
  result.sessions = sessions.length;

  return result;
}
