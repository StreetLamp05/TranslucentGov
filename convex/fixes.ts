import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { findResident, getOrCreateResident, requireFixer } from "./lib/auth";
import { MAX_CLIP_BYTES } from "../server/lib/clipLimit";
import { CITY_ONLY, neighborCanConfirm, tooFarMessage } from "../server/lib/fixRules";
import { haversineMeters, NEARBY_METERS } from "../server/lib/geo";
import { CLIP_TOO_BIG, MAX_VIDEO_FRAMES } from "../server/lib/postLimits";

// Proof of fix (§4.3.1, §4.3.2): files are uploaded first (files.generateUploadUrl), then
// submitFix saves the attempt as `checking` and starts verifyFix (US22), which closes the
// report on `verified`. A fixer passes `fixerToken`; a neighbor passes their device token as
// `residentToken`.

const authArgs = { fixerToken: v.optional(v.string()), residentToken: v.optional(v.string()) };

export const submitFix = mutation({
  args: {
    reportId: v.id("reports"),
    clipStorageId: v.id("_storage"),
    frameStorageIds: v.array(v.id("_storage")),
    lat: v.number(),
    lng: v.number(),
    ...authArgs,
  },
  handler: async (ctx, args) => {
    let by: Pick<Doc<"fixAttempts">, "byKind" | "byId">;
    if (args.fixerToken !== undefined) {
      by = { byKind: "fixer", byId: (await requireFixer(ctx, args.fixerToken))._id };
    } else if (args.residentToken !== undefined) {
      by = { byKind: "resident", byId: await getOrCreateResident(ctx, args.residentToken) };
    } else {
      throw new ConvexError("Missing token");
    }

    const report = await ctx.db.get(args.reportId);
    if (!report || report.status !== "open") throw new ConvexError("This report isn't open anymore.");
    if (by.byKind === "resident" && !neighborCanConfirm(report)) throw new ConvexError(CITY_ONLY);

    if (!Number.isFinite(args.lat) || !Number.isFinite(args.lng) || Math.abs(args.lat) > 90 || Math.abs(args.lng) > 180) {
      throw new ConvexError("That location isn't valid.");
    }
    // The geofence (§4.3.1), checked again here since the client's check can be skipped.
    const meters = haversineMeters(args, report);
    if (meters > NEARBY_METERS) throw new ConvexError(`${tooFarMessage(meters, NEARBY_METERS)}.`);

    const frames = args.frameStorageIds;
    if (frames.length < 1 || frames.length > MAX_VIDEO_FRAMES) {
      throw new ConvexError(`A fix clip needs 1 to ${MAX_VIDEO_FRAMES} frames.`);
    }
    if ((await storedSize(ctx, args.clipStorageId, "video")) > MAX_CLIP_BYTES) throw new ConvexError(CLIP_TOO_BIG);
    await Promise.all(frames.map((id) => storedSize(ctx, id, "image")));

    const attemptId = await ctx.db.insert("fixAttempts", {
      reportId: report._id,
      ...by,
      clipStorageId: args.clipStorageId,
      frameStorageIds: frames,
      lat: args.lat,
      lng: args.lng,
      status: "checking",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.fixVerification.verifyFix, { attemptId });
    return attemptId;
  },
});

// The same check as createReport's (posts.ts): throws unless the upload exists and is the
// right kind of file. An upload sent without a Content-Type has no type to check.
async function storedSize(ctx: MutationCtx, id: Id<"_storage">, kind: "video" | "image"): Promise<number> {
  const file = await ctx.db.system.get(id);
  if (!file) throw new ConvexError("An uploaded file is missing. Try recording again.");
  if (file.contentType && !file.contentType.startsWith(`${kind}/`)) {
    throw new ConvexError(kind === "video" ? "The clip isn't a video file." : "A frame isn't an image file.");
  }
  return file.size;
}

// The checking screen's view of one attempt: null unless the caller submitted it, so no one
// else can read Claude's reason. A bad token is just "not yours", since queries don't throw here.
export const myFixAttempt = query({
  args: { attemptId: v.id("fixAttempts"), ...authArgs },
  handler: async (ctx, { attemptId, fixerToken, residentToken }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return null;
    const callerId = await caller(ctx, attempt.byKind, { fixerToken, residentToken });
    if (!callerId || callerId !== attempt.byId) return null;
    return { reportId: attempt.reportId, status: attempt.status, reason: attempt.reason };
  },
});

async function caller(
  ctx: QueryCtx,
  kind: Doc<"fixAttempts">["byKind"],
  { fixerToken, residentToken }: { fixerToken?: string; residentToken?: string },
): Promise<Id<"fixers"> | Id<"residents"> | null> {
  if (kind === "resident") return residentToken === undefined ? null : await findResident(ctx, residentToken);
  if (fixerToken === undefined) return null;
  try {
    return (await requireFixer(ctx, fixerToken))._id;
  } catch (error) {
    if (error instanceof ConvexError) return null;
    throw error;
  }
}
