import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { fixAttempts, reports } from "./db/schema";
import { UserError } from "./lib/errors";
import type { Caller } from "./http";
import { parseId } from "./http";
import { MAX_CLIP_BYTES } from "./lib/clipLimit";
import { CITY_ONLY, neighborCanConfirm, tooFarMessage } from "./lib/fixRules";
import { haversineMeters, NEARBY_METERS } from "./lib/geo";
import { CLIP_TOO_BIG, MAX_VIDEO_FRAMES } from "./lib/postLimits";
import { enqueue } from "./jobs";
import { createUploadUrl, isUploadedBy, statObject, type Uploader } from "./storage";

// Proof of fix (§4.3.1, §4.3.2). Files are uploaded first (createProofUploadUrl, a presigned PUT
// to MinIO), then submitFix saves the attempt as `checking` and queues verifyFix (US36), which
// closes the report on `verified`. A fixer passes `as: "fixer"` and their fixer token; a neighbor
// passes `as: "resident"` and their device token. Ports convex/fixes.ts; routes are app/api/fixes/.

/** Who is submitting or reading an attempt: a fixer or a neighbor, by row id. */
export type By = { kind: "fixer" | "resident"; id: string };

const MISSING_TOKEN = "Missing token";

function asKind(as: unknown): By["kind"] {
  if (as === "fixer" || as === "resident") return as;
  throw new UserError(MISSING_TOKEN, 401);
}

/** The caller as the kind they say they are. A missing or bad token for that kind is a 401. */
export async function resolveBy(caller: Caller, as: unknown): Promise<By> {
  const kind = asKind(as);
  return kind === "fixer" ? { kind, id: (await caller.fixer()).id } : { kind, id: await caller.resident() };
}

/** Like resolveBy for reads: null instead of an error when the caller isn't who they say. */
export async function findBy(caller: Caller, as: unknown): Promise<By | null> {
  if (as !== "fixer" && as !== "resident") return null;
  try {
    if (as === "fixer") return { kind: as, id: (await caller.fixer()).id };
    const id = await caller.findResident();
    return id ? { kind: as, id } : null;
  } catch (error) {
    if (error instanceof UserError && error.status === 401) return null;
    throw error;
  }
}

const uploader = (by: By): Uploader => by;

// Only media goes in the proof bucket: MinIO is served from the app's origin (server/storage.ts).
const MEDIA_TYPE = /^(video|image)\/[a-z0-9.+-]+$/;

/** A presigned PUT URL for one clip or frame. */
export async function createProofUploadUrl(by: By, contentType: unknown): Promise<{ key: string; url: string }> {
  if (typeof contentType !== "string" || !MEDIA_TYPE.test(contentType)) {
    throw new UserError("Only video and image files can be uploaded.");
  }
  return createUploadUrl(contentType, uploader(by));
}

export type SubmitFixInput = {
  reportId: unknown;
  clipStorageId: unknown;
  frameStorageIds: unknown;
  lat: unknown;
  lng: unknown;
};

const isKeyList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "");

/** Saves the attempt as `checking` and queues verifyFix. Returns the attempt's id. */
export async function submitFix(by: By, input: SubmitFixInput): Promise<string> {
  const reportId = parseId(input.reportId);
  const [report] = reportId ? await db.select().from(reports).where(eq(reports.id, reportId)) : [];
  if (!report || report.status !== "open") throw new UserError("This report isn't open anymore.");
  if (by.kind === "resident" && !neighborCanConfirm({ status: report.status, owner: report.owner ?? undefined })) throw new UserError(CITY_ONLY);

  const { lat, lng, clipStorageId, frameStorageIds: frames } = input;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) ||
    Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new UserError("That location isn't valid.");
  }
  // The geofence (§4.3.1), checked again here since the client's check can be skipped.
  const meters = haversineMeters({ lat, lng }, report);
  if (meters > NEARBY_METERS) throw new UserError(`${tooFarMessage(meters, NEARBY_METERS)}.`);

  if (!isKeyList(frames) || frames.length < 1 || frames.length > MAX_VIDEO_FRAMES) {
    throw new UserError(`A fix clip needs 1 to ${MAX_VIDEO_FRAMES} frames.`);
  }
  if (typeof clipStorageId !== "string" || !clipStorageId) throw new UserError("A fix needs its clip.");

  const clipSize = await checkedSize(by, clipStorageId, "video");
  if (clipSize > MAX_CLIP_BYTES) throw new UserError(CLIP_TOO_BIG);
  await Promise.all(frames.map((key) => checkedSize(by, key, "image")));

  // One transaction, so verifyFix is queued only if the attempt exists (and the worker can read it).
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(fixAttempts)
      .values({
        reportId: report.id,
        byKind: by.kind,
        byId: by.id,
        clipStorageId,
        frameStorageIds: frames,
        lat,
        lng,
        status: "checking",
        createdAt: Date.now(),
      })
      .returning({ id: fixAttempts.id });
    await enqueue("verifyFix", { fixAttemptId: attempt.id }, { tx });
    return attempt.id;
  });
}

// Throws unless the caller uploaded the file and it's the right kind. Public URLs carry keys
// (§8), so a key that is merely valid isn't enough. An upload sent without a Content-Type has
// no type to check.
async function checkedSize(by: By, key: string, kind: "video" | "image"): Promise<number> {
  const file = (await isUploadedBy(key, uploader(by))) ? await statObject(key) : null;
  if (!file) throw new UserError("An uploaded file is missing. Try recording again.");
  if (file.contentType && !file.contentType.startsWith(`${kind}/`)) {
    throw new UserError(kind === "video" ? "The clip isn't a video file." : "A frame isn't an image file.");
  }
  return file.size;
}

/**
 * The checking screen's view of one attempt: null unless the caller submitted it, so no one
 * else can read Claude's reason.
 */
export async function myFixAttempt(by: By | null, rawId: string) {
  const id = parseId(rawId);
  if (!by || !id) return null;
  const [attempt] = await db
    .select({ reportId: fixAttempts.reportId, status: fixAttempts.status, reason: fixAttempts.reason })
    .from(fixAttempts)
    .where(and(eq(fixAttempts.id, id), eq(fixAttempts.byKind, by.kind), eq(fixAttempts.byId, by.id)));
  return attempt ? { reportId: attempt.reportId, status: attempt.status, reason: attempt.reason ?? undefined } : null;
}
