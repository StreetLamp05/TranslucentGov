import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { isAdminPasscode } from "../server/lib/adminPasscode";
import { getOrCreateResident } from "./lib/auth";
import { MAX_CLIP_BYTES } from "../server/lib/clipLimit";
import { CITY_ONLY, neighborCanConfirm } from "../server/lib/fixRules";
import { CLIP_TOO_BIG, MAX_DESCRIPTION_LENGTH, MAX_PHOTOS, MAX_VIDEO_FRAMES } from "../server/lib/postLimits";
import { mediaTypeValidator } from "./schema";

// Sample reports for the demo (§6.1.1), from /admin/seed. Each sample goes through the real
// screenReport, then optionally the real verifyFix. Every function here checks ADMIN_PASSCODE
// server-side; the page only ever holds what the admin typed.

// Batches are screened 10 s apart, so they stay under the model API's tokens-per-minute limit.
export const SCREEN_STAGGER_MS = 10_000;
// A seed fix waits for its report's screening, checking this often for up to 10 minutes.
export const POLL_MS = 10_000;
export const MAX_POLLS = 60;

const WRONG_PASSCODE = "Wrong admin passcode";
export const TRANSCRIBABLE = ["video/mp4", "video/webm"];
export const NOT_TRANSCRIBABLE = "the clip must be MP4 or WebM (convert an iPhone .MOV first).";

function requireAdmin(passcode: string) {
  if (!isAdminPasscode(passcode)) throw new ConvexError(WRONG_PASSCODE);
}

export const generateUploadUrl = mutation({
  args: { passcode: v.string() },
  handler: async (ctx, { passcode }) => {
    requireAdmin(passcode);
    return await ctx.storage.generateUploadUrl();
  },
});

// For the page's "fixed by" picker. Fixers come from `fixers:seed` (US21).
export const fixers = query({
  args: { passcode: v.string() },
  handler: async (ctx, { passcode }) => {
    requireAdmin(passcode);
    const rows = await ctx.db.query("fixers").collect();
    return rows.map(({ _id, name, org }) => ({ _id, name, org }));
  },
});

// Every sample with its screening and fix progress, newest first, so the admin can watch a
// batch finish and spot one to `rescreen` or `release` (§4.2.1).
export const samples = query({
  args: { passcode: v.string() },
  handler: async (ctx, { passcode }) => {
    requireAdmin(passcode);
    const reports = await ctx.db.query("reports").order("desc").collect();
    return await Promise.all(
      reports
        .filter((report) => report.isSample)
        .map(async (report) => {
          const attempts = await ctx.db
            .query("fixAttempts")
            .withIndex("by_report", (q) => q.eq("reportId", report._id))
            .collect();
          const fix = attempts.at(-1);
          return {
            _id: report._id,
            status: report.status,
            title: report.title,
            category: report.category,
            agency: report.agency,
            verdict: report.verdict,
            reason: report.reason,
            lat: report.lat,
            lng: report.lng,
            createdAt: report.createdAt,
            fixedAt: report.fixedAt,
            fix: fix ? { status: fix.status, reason: fix.reason } : null,
          };
        }),
    );
  },
});

const fixByValidator = v.union(
  v.object({ kind: v.literal("fixer"), fixerId: v.id("fixers") }),
  v.object({ kind: v.literal("resident") }),
);

const fixValidator = v.object({
  clipStorageId: v.id("_storage"),
  frameStorageIds: v.array(v.id("_storage")),
  by: fixByValidator,
  fixedAt: v.optional(v.number()),
});
type SeedFix = Infer<typeof fixValidator>;

const sampleValidator = v.object({
  mediaType: mediaTypeValidator,
  clipStorageId: v.optional(v.id("_storage")),
  frameStorageIds: v.array(v.id("_storage")),
  description: v.optional(v.string()),
  lat: v.number(),
  lng: v.number(),
  // Backdating (§6.1.1). Each defaults to now; lastActivityAt defaults to createdAt.
  createdAt: v.optional(v.number()),
  lastActivityAt: v.optional(v.number()),
  // This device's resident token, so the demo phone's Me page shows the sample (§5.4.1).
  residentToken: v.optional(v.string()),
  fix: v.optional(fixValidator),
});
type Sample = Infer<typeof sampleValidator>;

// Inserts each sample as a pending `isSample` report and schedules the real screenReport,
// SCREEN_STAGGER_MS apart. A fix clip is attached once its report is open (attachFix).
export const seedSamples = mutation({
  args: { passcode: v.string(), samples: v.array(sampleValidator) },
  handler: async (ctx, { passcode, samples }) => {
    requireAdmin(passcode);
    const now = Date.now();
    // All checks first, so a bad sample leaves nothing half-seeded.
    for (const [i, sample] of samples.entries()) await check(ctx, sample, now, `Sample ${i + 1}`);

    const reportIds: Id<"reports">[] = [];
    for (const [i, sample] of samples.entries()) {
      const residentId = await getOrCreateResident(ctx, sample.residentToken ?? crypto.randomUUID());
      const createdAt = sample.createdAt ?? now;
      const lastActivityAt = sample.lastActivityAt ?? createdAt;
      const reportId = await ctx.db.insert("reports", {
        residentId,
        mediaType: sample.mediaType,
        description: sample.description?.trim() || undefined,
        clipStorageId: sample.clipStorageId,
        frameStorageIds: sample.frameStorageIds,
        lat: sample.lat,
        lng: sample.lng,
        status: "pending",
        audioMuted: false,
        isSample: true,
        meTooCount: 0,
        lastActivityAt,
        revealViews: 0,
        createdAt,
      });
      const delay = i * SCREEN_STAGGER_MS;
      await ctx.scheduler.runAfter(delay, internal.screening.screenReport, { reportId });
      if (sample.fix) {
        await ctx.scheduler.runAfter(delay + POLL_MS, internal.seed.attachFix, {
          reportId,
          fix: sample.fix,
          lastActivityAt,
          polls: 0,
        });
      }
      reportIds.push(reportId);
    }
    return reportIds;
  },
});

type Fail = (message: string) => never;

async function check(ctx: MutationCtx, sample: Sample, now: number, label: string) {
  const fail: Fail = (message) => {
    throw new ConvexError(`${label}: ${message}`);
  };
  const { lat, lng } = sample;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    fail("that location isn't valid.");
  }
  if (sample.description && sample.description.trim().length > MAX_DESCRIPTION_LENGTH) {
    fail(`the description can be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  const createdAt = sample.createdAt ?? now;
  const lastActivityAt = sample.lastActivityAt ?? createdAt;
  const fixedAt = sample.fix?.fixedAt;
  if ([createdAt, lastActivityAt, fixedAt ?? now].some((t) => !Number.isFinite(t) || t > now)) {
    fail("a date is in the future.");
  }
  if (lastActivityAt < createdAt) fail("last activity is before it was posted.");
  if (fixedAt !== undefined && fixedAt < createdAt) fail("it was fixed before it was posted.");

  const frames = sample.frameStorageIds;
  if (sample.mediaType === "video") {
    if (!sample.clipStorageId) fail("a video sample needs its clip.");
    if (frames.length < 1 || frames.length > MAX_VIDEO_FRAMES) fail(`a video needs 1 to ${MAX_VIDEO_FRAMES} frames.`);
    const clip = await stored(ctx, sample.clipStorageId, "video", fail);
    if (clip.size > MAX_CLIP_BYTES) fail(CLIP_TOO_BIG);
    // Transcription only takes these (lib/transcribe.ts), so anything else (an iPhone .MOV) would be
    // held as "screening failed" with no way to rescreen it.
    const type = (clip.contentType ?? "").split(";")[0].trim().toLowerCase();
    if (!TRANSCRIBABLE.includes(type)) fail(NOT_TRANSCRIBABLE);
  } else {
    if (sample.clipStorageId) fail("a photo sample can't have a clip.");
    if (frames.length < 1 || frames.length > MAX_PHOTOS) fail(`a photo sample needs 1 to ${MAX_PHOTOS} photos.`);
  }
  for (const id of frames) await stored(ctx, id, "image", fail);

  if (sample.fix) {
    const fix = sample.fix;
    if (fix.frameStorageIds.length < 1 || fix.frameStorageIds.length > MAX_VIDEO_FRAMES) {
      fail(`a fix clip needs 1 to ${MAX_VIDEO_FRAMES} frames.`);
    }
    if ((await stored(ctx, fix.clipStorageId, "video", fail)).size > MAX_CLIP_BYTES) fail(CLIP_TOO_BIG);
    for (const id of fix.frameStorageIds) await stored(ctx, id, "image", fail);
    if (fix.by.kind === "fixer" && !(await ctx.db.get(fix.by.fixerId))) fail("that fixer doesn't exist.");
  }
}

// The upload, after checking it exists and is the right kind of file (as createReport does).
async function stored(ctx: MutationCtx, id: Id<"_storage">, kind: "video" | "image", fail: Fail) {
  const file = await ctx.db.system.get(id);
  if (!file) fail("an uploaded file is missing.");
  if (file.contentType && !file.contentType.startsWith(`${kind}/`)) fail(`a file isn't ${kind === "video" ? "a video" : "an image"}.`);
  return file;
}

// Waits for the report's screening, then files the fix clip as an attempt and runs the real
// verifyFix (§4.3.1). An attempt filed while the report is pending would be superseded.
export const attachFix = internalMutation({
  args: { reportId: v.id("reports"), fix: fixValidator, lastActivityAt: v.number(), polls: v.number() },
  handler: async (ctx, { reportId, fix, lastActivityAt, polls }) => {
    const report = await ctx.db.get(reportId);
    if (!report) return;
    if (report.status === "pending") {
      if (polls + 1 >= MAX_POLLS) {
        console.warn(`seed: ${reportId} is still pending after ${MAX_POLLS} checks, so its fix clip was dropped`);
        return;
      }
      await ctx.scheduler.runAfter(POLL_MS, internal.seed.attachFix, { reportId, fix, lastActivityAt, polls: polls + 1 });
      return;
    }
    if (report.status !== "open") {
      console.warn(`seed: ${reportId} is ${report.status}, so its fix clip was dropped. Release it, then seed the fix again.`);
      return;
    }

    const byId = await fixerOrNeighbor(ctx, report, fix.by);
    if (!byId) return;
    const attemptId = await ctx.db.insert("fixAttempts", {
      reportId,
      byKind: fix.by.kind,
      byId,
      clipStorageId: fix.clipStorageId,
      frameStorageIds: fix.frameStorageIds,
      lat: report.lat,
      lng: report.lng,
      status: "checking",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.fixVerification.verifyFix, { attemptId });
    if (fix.fixedAt !== undefined) {
      await ctx.scheduler.runAfter(POLL_MS, internal.seed.backdateFix, {
        attemptId,
        fixedAt: fix.fixedAt,
        lastActivityAt,
        polls: 0,
      });
    }
  },
});

// A neighbor can only confirm a report the city doesn't own (§4.3.2); the seed obeys that too.
async function fixerOrNeighbor(
  ctx: MutationCtx,
  report: Doc<"reports">,
  by: SeedFix["by"],
): Promise<Id<"fixers"> | Id<"residents"> | null> {
  if (by.kind === "fixer") {
    if (await ctx.db.get(by.fixerId)) return by.fixerId;
    console.warn(`seed: the fixer for ${report._id} no longer exists, so its fix clip was dropped`);
    return null;
  }
  if (!neighborCanConfirm(report)) {
    console.warn(`seed: ${report._id}: ${CITY_ONLY} Its neighbor fix clip was dropped; seed it with a fixer.`);
    return null;
  }
  return await getOrCreateResident(ctx, crypto.randomUUID());
}

// applyFixVerdict stamps fixedAt as now; a sample may be backdated (§6.1.1). Feed order
// follows lastActivityAt (§5.1.2), so it becomes the later of the seeded value and fixedAt.
export const backdateFix = internalMutation({
  args: { attemptId: v.id("fixAttempts"), fixedAt: v.number(), lastActivityAt: v.number(), polls: v.number() },
  handler: async (ctx, { attemptId, fixedAt, lastActivityAt, polls }) => {
    const attempt = await ctx.db.get(attemptId);
    if (!attempt) return;
    if (attempt.status === "checking") {
      if (polls + 1 >= MAX_POLLS) {
        console.warn(`seed: fix attempt ${attemptId} is still checking after ${MAX_POLLS} checks, so fixedAt wasn't backdated`);
        return;
      }
      await ctx.scheduler.runAfter(POLL_MS, internal.seed.backdateFix, {
        attemptId,
        fixedAt,
        lastActivityAt,
        polls: polls + 1,
      });
      return;
    }
    if (attempt.status !== "verified") return;
    const report = await ctx.db.get(attempt.reportId);
    // Only the fix this attempt made: not one closed by another attempt.
    if (!report || report.status !== "fixed" || report.fixStorageId !== attempt.clipStorageId) return;
    await ctx.db.patch(report._id, { fixedAt, lastActivityAt: Math.max(lastActivityAt, fixedAt) });
  },
});
