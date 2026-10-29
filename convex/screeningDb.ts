// Internal mutations for internal.screening.screenReport (US13). They live here, not in
// screening.ts, because a "use node" file can only contain actions.
import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { ROUTING } from "../server/lib/routing";
import { SCREENING_FAILED_REASON, screeningErrorSummary } from "../server/lib/screening";
import { categoryValidator, segmentValidator, verdictValidator } from "./schema";

// The files being screened. A retake replaces them on the same report (§4.2.1), so a result
// for the old files must not land on the new ones.
const mediaValidator = v.object({
  clipStorageId: v.optional(v.id("_storage")),
  frameStorageIds: v.array(v.id("_storage")),
});
type Media = Infer<typeof mediaValidator>;

// §4.2.1: each verdict maps to exactly one status.
const STATUS_FOR: Record<Infer<typeof verdictValidator>, "open" | "held"> = {
  pass: "open",
  mute: "open",
  retake: "held",
  reject: "held",
  emergency: "held",
};

// Going public moves a report to the top of the feed (§5.1.2). Samples keep the backdated
// order US25 seeds them with (§6.1.1).
function publishBump(report: Doc<"reports">) {
  return report.isSample ? {} : { lastActivityAt: Date.now() };
}

function sameMedia(report: Doc<"reports">, media: Media): boolean {
  return (
    report.clipStorageId === media.clipStorageId &&
    report.frameStorageIds.length === media.frameStorageIds.length &&
    report.frameStorageIds.every((id, i) => id === media.frameStorageIds[i])
  );
}

// The report, while a result for `media` still belongs on it. When the load itself failed
// there's no media to compare, so only the status is checked.
async function stillScreening(ctx: MutationCtx, reportId: Id<"reports">, media: Media | undefined) {
  const report = await ctx.db.get(reportId);
  if (!report || report.status !== "pending") return null;
  if (media && !sameMedia(report, media)) return null;
  return report;
}

// What the action needs, or null to stop: screening only runs on a pending report.
export const loadForScreening = internalQuery({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (!report || report.status !== "pending") return null;
    const clip = report.clipStorageId ? await ctx.db.system.get(report.clipStorageId) : null;
    return {
      mediaType: report.mediaType,
      media: { clipStorageId: report.clipStorageId, frameStorageIds: report.frameStorageIds },
      clipContentType: clip?.contentType,
      description: report.description,
      lat: report.lat,
      lng: report.lng,
      street: report.street, // geocoded once per report (§1.1.2)
    };
  },
});

export const applyVerdict = internalMutation({
  args: {
    reportId: v.id("reports"),
    media: mediaValidator,
    verdict: verdictValidator,
    reason: v.string(),
    category: categoryValidator,
    title: v.string(),
    street: v.optional(v.string()),
    transcript: v.optional(v.string()),
    segments: v.optional(v.array(segmentValidator)),
  },
  handler: async (ctx, { reportId, media, verdict, category, transcript, segments, ...fields }) => {
    const report = await stillScreening(ctx, reportId, media);
    if (!report) return;
    const status = STATUS_FOR[verdict];
    await ctx.db.patch(reportId, {
      ...fields,
      // Explicit, because Convex drops undefined arguments: a photo retake of a narrated
      // video must not keep the old transcript. A missing street keeps the stored one.
      transcript,
      segments,
      category,
      ...ROUTING[category], // owner and agency (§2.1.2)
      verdict,
      status,
      audioMuted: verdict === "mute",
      ...(status === "open" ? publishBump(report) : {}),
    });
  },
});

// After the retry also fails (§4.2.1).
export const markFailed = internalMutation({
  args: { reportId: v.id("reports"), media: v.optional(mediaValidator), error: v.optional(v.string()) },
  handler: async (ctx, { reportId, media, error }) => {
    if (!(await stillScreening(ctx, reportId, media))) return;
    // Clear what an earlier screening of other media left, so `release` can't publish media
    // nobody screened.
    await ctx.db.patch(reportId, {
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: error === undefined ? undefined : screeningErrorSummary(error),
      verdict: undefined,
      category: undefined,
      owner: undefined,
      agency: undefined,
      title: undefined,
      audioMuted: false,
    });
  },
});

// For the demo, from `npx convex run screeningDb:rescreen '{"reportId": "..."}'` (§4.2.1).
// Held, or pending when screening is stuck (an action that died never retries). A duplicate
// run on a pending report is safe: the second result finds it no longer pending.
export const rescreen = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("No such report.");
    // An open or fixed report would drop off the feed.
    if (report.status !== "held" && report.status !== "pending") {
      throw new ConvexError(`Only a held or pending report can be rescreened (this one is ${report.status}).`);
    }
    await ctx.db.patch(reportId, { status: "pending", verdict: undefined, reason: undefined, screeningError: undefined });
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId });
  },
});

// "held → open only by hand" (§4.2.1): `npx convex run screeningDb:release '{"reportId": "...", "force": true}'`.
export const release = internalMutation({
  args: { reportId: v.id("reports"), force: v.optional(v.boolean()) },
  handler: async (ctx, { reportId, force }) => {
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("No such report.");
    if (report.status !== "held") throw new ConvexError(`Only a held report can be released (this one is ${report.status}).`);
    // A card can't render without these, e.g. after "screening failed". Rescreen it instead.
    if (!report.category || !report.title) {
      throw new ConvexError("This report has no category or title yet. Rescreen it instead.");
    }
    // A held verdict outranks mute (§4.2.1), so its audio and text were never checked for
    // names or slurs. Make the operator see the verdict and confirm.
    if (report.verdict && STATUS_FOR[report.verdict] === "held" && !force) {
      throw new ConvexError(
        `This report was held as ${report.verdict} ("${report.reason ?? ""}"), and its audio and text were never checked for mute. Pass "force": true to release it anyway.`,
      );
    }
    await ctx.db.patch(reportId, { status: "open", ...publishBump(report) });
  },
});
