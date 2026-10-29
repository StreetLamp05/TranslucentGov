import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { findResident } from "./lib/auth";
import { checkPostMedia } from "./lib/postMedia";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "../server/lib/screening";
import { mediaTypeValidator } from "./schema";

// The poster's way out of a hold (§4.2.1), from the Checking… screen (US14) and the Me page
// (US24). Both put the report back to `pending` and re-run screening (held → pending, §2.1.3).

// The caller's own report. Someone else's, or a missing one, gets the same answer, so the
// error can't confirm a report exists.
async function ownReport(ctx: MutationCtx, token: string, reportId: Id<"reports">): Promise<Doc<"reports">> {
  const residentId = await findResident(ctx, token);
  const report = await ctx.db.get(reportId);
  if (!residentId || !report || report.residentId !== residentId) {
    throw new ConvexError("We couldn't find this post.");
  }
  return report;
}

// Retake (§4.2.1): the new recording replaces the clip on the same report. The old files are
// deleted, since the poster was told they weren't OK to publish.
export const retakeReport = mutation({
  args: {
    token: v.string(),
    reportId: v.id("reports"),
    mediaType: mediaTypeValidator,
    clipStorageId: v.optional(v.id("_storage")),
    frameStorageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, { token, reportId, ...media }) => {
    const report = await ownReport(ctx, token, reportId);
    if (report.status !== "held" || report.verdict !== "retake") {
      throw new ConvexError("This post can't be retaken.");
    }
    // Record again, not switch formats: a video post stays a video, a slideshow stays photos.
    if (media.mediaType !== report.mediaType) {
      throw new ConvexError(report.mediaType === "video" ? "Record a new video for this post." : "Pick new photos for this post.");
    }
    const oldFiles = [report.clipStorageId, ...report.frameStorageIds].filter((id) => id !== undefined);
    // Reusing an old file would delete it out from under the new post.
    if ([media.clipStorageId, ...media.frameStorageIds].some((id) => id && oldFiles.includes(id))) {
      throw new ConvexError("A retake needs new files.");
    }
    await checkPostMedia(ctx, media);

    // The old files' screening result goes too, like markFailed's, so nothing from the deleted
    // files outlives them. New files start a fresh Try again count.
    await ctx.db.patch(reportId, {
      clipStorageId: media.clipStorageId,
      frameStorageIds: media.frameStorageIds,
      status: "pending",
      verdict: undefined,
      reason: undefined,
      category: undefined,
      owner: undefined,
      agency: undefined,
      title: undefined,
      transcript: undefined,
      segments: undefined,
      audioMuted: false,
      screeningError: undefined,
      screeningRetries: undefined,
    });
    for (const id of oldFiles) {
      // A file already gone (e.g. purged) is skipped rather than failing the retake.
      if (await ctx.db.system.get(id)) await ctx.storage.delete(id);
    }
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId });
  },
});

// Try again after "screening failed" (§4.2.1): the same files, screened again, up to
// MAX_SCREENING_RETRIES times. Some files always fail (an iPhone .mov, §8), so it can't loop forever.
export const retryScreening = mutation({
  args: { token: v.string(), reportId: v.id("reports") },
  handler: async (ctx, { token, reportId }) => {
    const report = await ownReport(ctx, token, reportId);
    if (report.status !== "held" || report.reason !== SCREENING_FAILED_REASON) {
      throw new ConvexError("This post isn't waiting on a failed check.");
    }
    const retries = report.screeningRetries ?? 0;
    if (retries >= MAX_SCREENING_RETRIES) throw new ConvexError("We've already tried checking this post again.");
    await ctx.db.patch(reportId, {
      status: "pending",
      verdict: undefined,
      reason: undefined,
      screeningError: undefined,
      screeningRetries: retries + 1,
    });
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId });
  },
});
