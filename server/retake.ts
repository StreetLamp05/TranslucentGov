import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";
import { enqueue } from "./jobs";
import { UserError } from "./lib/errors";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "./lib/screening";
import { assertKeysUnused, checkResidentMedia, mediaKeys, type PostMedia } from "./posts";
import { deleteObject } from "./storage";

// The poster's way out of a hold (§4.2.1), from the Checking… screen (US14) and the Me page
// (US24). Both put the report back to `pending` and queue screening again (held → pending, §2.1.3).

const NOT_FOUND = "We couldn't find this post.";

// Locks and returns the caller's own report. Someone else's, or a missing one, gets the same
// answer, so the error can't confirm a report exists.
async function lockOwnReport(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], residentId: string, reportId: string | null) {
  if (!reportId) throw new UserError(NOT_FOUND);
  const [report] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.residentId, residentId)))
    .for("update");
  if (!report) throw new UserError(NOT_FOUND);
  return report;
}

// Retake (§4.2.1): the new recording replaces the clip on the same report. The old files are
// deleted once the swap commits, since the poster was told they weren't OK to publish.
export async function retakeReport(residentId: string, reportId: string | null, media: PostMedia): Promise<void> {
  if (!reportId) throw new UserError(NOT_FOUND);
  const [current] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.residentId, residentId)));
  if (!current) throw new UserError(NOT_FOUND);
  if (current.status !== "held" || current.verdict !== "retake") throw new UserError("This post can't be retaken.");
  // Record again, not switch formats: a video post stays a video, a slideshow stays photos.
  if (media.mediaType !== current.mediaType) {
    throw new UserError(current.mediaType === "video" ? "Record a new video for this post." : "Pick new photos for this post.");
  }
  const newKeys = [media.clipStorageId, ...media.frameStorageIds];
  // Reusing an old file would delete it out from under the new post.
  const used = [current.clipStorageId, ...current.frameStorageIds];
  if (newKeys.some((key) => key && used.includes(key))) throw new UserError("A retake needs new files.");
  await checkResidentMedia(residentId, media);

  const oldFiles = await db.transaction(async (tx) => {
    // Re-read under the lock: the report may have moved on since the checks above.
    const report = await lockOwnReport(tx, residentId, reportId);
    if (report.status !== "held" || report.verdict !== "retake") throw new UserError("This post can't be retaken.");
    // Another post's file would be deleted along with this one's later.
    await assertKeysUnused(tx, mediaKeys(media), reportId);
    // The old files' screening result goes too, like markFailed's, so nothing from the deleted
    // files outlives them. New files start a fresh Try again count.
    await tx
      .update(reports)
      .set({
        clipStorageId: media.clipStorageId ?? null,
        frameStorageIds: media.frameStorageIds,
        status: "pending",
        verdict: null,
        reason: null,
        category: null,
        owner: null,
        agency: null,
        title: null,
        transcript: null,
        segments: null,
        segmentsEs: null,
        audioMuted: false,
        screeningError: null,
        screeningRetries: null,
      })
      .where(eq(reports.id, reportId));
    await enqueue("screenReport", { reportId }, { tx });
    return [report.clipStorageId, ...report.frameStorageIds].filter((key): key is string => !!key);
  });

  // After the commit, so a failed swap never costs the poster their files. A file already gone
  // is skipped rather than failing the retake, and a stray MinIO error only leaves a file for the purge.
  await Promise.all(oldFiles.map((key) => deleteObject(key).catch((error) => console.error("retake: delete", key, error))));
}

// Try again after "screening failed" (§4.2.1): the same files, screened again, up to
// MAX_SCREENING_RETRIES times. Some files always fail (an iPhone .mov, §8), so it can't loop forever.
export async function retryScreening(residentId: string, reportId: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const report = await lockOwnReport(tx, residentId, reportId);
    if (report.status !== "held" || report.reason !== SCREENING_FAILED_REASON) {
      throw new UserError("This post isn't waiting on a failed check.");
    }
    const retries = report.screeningRetries ?? 0;
    if (retries >= MAX_SCREENING_RETRIES) throw new UserError("We've already tried checking this post again.");
    await tx
      .update(reports)
      .set({ status: "pending", verdict: null, reason: null, screeningError: null, screeningRetries: retries + 1 })
      .where(eq(reports.id, report.id));
    await enqueue("screenReport", { reportId: report.id }, { tx });
  });
}
