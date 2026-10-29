import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CATEGORIES, OWNERS } from "../server/lib/routing";

// The full GovTok schema (§2.1.1). US5 is the only card that edits this file, so
// feature cards can run in parallel. Fields that aren't known until screening are optional.

export const categoryValidator = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const ownerValidator = v.union(...OWNERS.map((o) => v.literal(o)));

export const mediaTypeValidator = v.union(v.literal("video"), v.literal("photos"));

// §2.1.3
export const reportStatusValidator = v.union(
  v.literal("pending"),
  v.literal("held"),
  v.literal("open"),
  v.literal("fixed"),
);

// §4.2.1
export const verdictValidator = v.union(
  v.literal("pass"),
  v.literal("mute"),
  v.literal("retake"),
  v.literal("emergency"),
  v.literal("reject"),
);

// §4.3.2
export const fixedByKindValidator = v.union(v.literal("fixer"), v.literal("resident"));

// §4.3.1
export const fixAttemptStatusValidator = v.union(
  v.literal("checking"),
  v.literal("verified"),
  v.literal("not_fixed"),
  v.literal("retake"),
  v.literal("failed"),
  v.literal("superseded"),
);

// Transcript segment timestamps, in seconds (§1.1.4).
export const segmentValidator = v.object({ start: v.number(), end: v.number(), text: v.string() });

export default defineSchema({
  reports: defineTable({
    residentId: v.id("residents"), // never public (§7.1.1)
    mediaType: mediaTypeValidator,
    description: v.optional(v.string()), // ≤280 characters (§4.1.1)
    clipStorageId: v.optional(v.id("_storage")), // videos only
    frameStorageIds: v.array(v.id("_storage")), // ~6 frames for a video, or the 1–10 photos
    transcript: v.optional(v.string()),
    segments: v.optional(v.array(segmentValidator)),
    lat: v.number(),
    lng: v.number(),
    street: v.optional(v.string()),
    category: v.optional(categoryValidator),
    owner: v.optional(ownerValidator), // from ROUTING, never from Claude (§2.1.2)
    agency: v.optional(v.string()),
    title: v.optional(v.string()),
    status: reportStatusValidator,
    verdict: v.optional(verdictValidator),
    reason: v.optional(v.string()),
    // "screening failed" holds (§4.2.1): the last error, shown to the poster for debugging,
    // and how many Try again taps are used (capped at MAX_SCREENING_RETRIES).
    screeningError: v.optional(v.string()),
    screeningRetries: v.optional(v.number()),
    audioMuted: v.boolean(),
    isSample: v.boolean(),
    meTooCount: v.number(),
    lastActivityAt: v.number(),
    revealViews: v.number(),
    createdAt: v.number(), // explicit, so samples can be backdated (§6.1.1)
    fixStorageId: v.optional(v.id("_storage")),
    fixedAt: v.optional(v.number()),
    fixedBy: v.optional(v.union(v.id("fixers"), v.id("residents"))), // never public
    fixedByKind: v.optional(fixedByKindValidator),
    fixedByOrg: v.optional(v.string()),
  })
    .index("by_lastActivity", ["lastActivityAt"])
    .index("by_status_lat", ["status", "lat"])
    .index("by_resident", ["residentId"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  meToos: defineTable({
    reportId: v.id("reports"),
    residentId: v.id("residents"),
    createdAt: v.number(),
  })
    .index("by_report_resident", ["reportId", "residentId"])
    .index("by_resident", ["residentId"]),

  residents: defineTable({
    token: v.string(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  fixers: defineTable({
    name: v.string(),
    org: v.string(),
    passcode: v.string(),
    token: v.optional(v.string()), // issued when the passcode is checked (§3.1.2)
  })
    .index("by_passcode", ["passcode"])
    .index("by_token", ["token"]),

  // A fix waits here while Claude checks it (§4.3.1).
  fixAttempts: defineTable({
    reportId: v.id("reports"),
    byKind: fixedByKindValidator,
    byId: v.union(v.id("fixers"), v.id("residents")),
    clipStorageId: v.id("_storage"),
    frameStorageIds: v.array(v.id("_storage")),
    lat: v.number(),
    lng: v.number(),
    status: fixAttemptStatusValidator,
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_report", ["reportId"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  // US1 placeholder, still used by app/page.tsx. Dropped in a follow-up once US6 replaces that page.
  placeholder: defineTable({
    label: v.string(),
    count: v.number(),
  }),
  videoIntake: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    fileSize: v.number(),
    status: v.union(
      v.literal("uploaded"),
      v.literal("transcribing"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    transcript: v.optional(v.string()),
    segments: v.optional(
      v.array(
        v.object({
          start: v.number(),
          end: v.number(),
          text: v.string(),
        }),
      ),
    ),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_created_at", ["createdAt"]),

  videoIntakeAdminSessions: defineTable({
    token: v.string(),
    expiresAt: v.number(),
  })
    .index("by_token", ["token"])
    .index("by_expires_at", ["expiresAt"]),
});
