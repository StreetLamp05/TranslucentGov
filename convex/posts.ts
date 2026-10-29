import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { findResident, getOrCreateResident } from "./lib/auth";
import { MAX_DESCRIPTION_LENGTH } from "../server/lib/postLimits";
import { checkPostMedia } from "./lib/postMedia";
import { ownerReport } from "./lib/publicReport";
import { mediaTypeValidator } from "./schema";

// A resident's post (§4.1.1): files are uploaded first (files.generateUploadUrl), then this
// saves the report as `pending` and starts screening (§2.1.3). Video and photo posts both
// come through here, so the photo branch (US9) is UI-only.
export const createReport = mutation({
  args: {
    token: v.string(),
    mediaType: mediaTypeValidator,
    clipStorageId: v.optional(v.id("_storage")),
    frameStorageIds: v.array(v.id("_storage")),
    description: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (ctx, args) => {
    const residentId = await getOrCreateResident(ctx, args.token);

    const description = args.description?.trim() || undefined;
    if (description && description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ConvexError(`The description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
    }
    if (!Number.isFinite(args.lat) || !Number.isFinite(args.lng) || Math.abs(args.lat) > 90 || Math.abs(args.lng) > 180) {
      throw new ConvexError("That location isn't valid.");
    }

    await checkPostMedia(ctx, args);

    const now = Date.now();
    const reportId = await ctx.db.insert("reports", {
      residentId,
      mediaType: args.mediaType,
      description,
      clipStorageId: args.clipStorageId,
      frameStorageIds: args.frameStorageIds,
      lat: args.lat,
      lng: args.lng,
      status: "pending",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: now,
      revealViews: 0,
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId });
    return reportId;
  },
});

// The poster's own report, for the Checking… screen (§4.2.1): null unless the token's
// resident posted it (§7.1.1), so another device can't read a held clip or its reason.
export const myReport = query({
  args: { token: v.string(), reportId: v.id("reports") },
  handler: async (ctx, { token, reportId }) => {
    const residentId = await findResident(ctx, token);
    if (!residentId) return null;
    const report = await ctx.db.get(reportId);
    if (!report || report.residentId !== residentId) return null;
    return await ownerReport(ctx, report, residentId);
  },
});
