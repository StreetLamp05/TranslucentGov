import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { videoIntake, type VideoIntake } from "./db/schema";
import { parseId } from "./http";
import { enqueue } from "./jobs";
import { MAX_CLIP_BYTES } from "./lib/clipLimit";
import { UserError } from "./lib/errors";
import { assertKeysUnused, FILE_IN_USE } from "./posts";
import type { Tx } from "./jobs";
import { validateVideoMetadata } from "./lib/videoIntakeValidation";
import { deleteObject, isUploadedBy, statObject } from "./storage";

// The admin video intake (/admin/video-intake): an admin uploads an MP4 or WebM to MinIO, this
// saves it, and the `transcribeVideo` job (server/jobs/transcribeVideo.ts) transcribes it with
// Gemini. Routes are app/api/admin/video-intake. Rows older than
// 7 days are deleted with their video by the nightly purge (server/purge.ts).

// The job's name, as in server/jobs/transcribeVideo.ts (not imported: that would pull Gemini into the route).
const TRANSCRIBE_VIDEO = "transcribeVideo";

const UPLOAD_MISSING = "The uploaded video could not be found. Upload it again.";
const SIZE_MISMATCH = "Uploaded video size does not match the validated file size.";

/** Throws unless no intake entry holds any of these keys: seed and intake must not share a file. */
export async function assertNotIntake(tx: Pick<Tx, "select">, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const [entry] = await tx.select({ id: videoIntake.id }).from(videoIntake).where(inArray(videoIntake.storageId, keys)).limit(1);
  if (entry) throw new UserError(FILE_IN_USE);
}

// Whether a report, fix attempt or intake entry already holds the key. A rejected upload is only
// deleted when nothing does, since the purge or a retake would otherwise break their media too.
async function keyInUse(key: string): Promise<boolean> {
  try {
    await db.transaction((tx) => assertKeysUnused(tx, [key]));
    await assertNotIntake(db, [key]);
    return false;
  } catch (error) {
    if (error instanceof UserError) return true;
    throw error;
  }
}

const mediaType = (contentType: string) => contentType.split(";")[0].trim().toLowerCase();

/**
 * Records an uploaded video and queues its transcription. The stored object is checked, not the
 * client's metadata: its size and type must match what the client says, and be allowed. A
 * rejected upload is deleted. Saving the same key twice returns the first entry.
 */
export async function saveUpload(input: {
  key: unknown;
  fileName: unknown;
  contentType: unknown;
  fileSize: unknown;
}): Promise<string> {
  const { key, fileName, contentType: declaredType, fileSize } = input;
  if (typeof key !== "string" || !key) throw new UserError(UPLOAD_MISSING);
  if (typeof declaredType !== "string" || typeof fileSize !== "number") throw new UserError("Invalid upload details.");
  // Only the admin's own uploads: a key alone proves nothing, and a rejected one gets deleted below.
  if (!(await isUploadedBy(key, { kind: "admin" }))) throw new UserError(UPLOAD_MISSING);
  const stored = await statObject(key);
  if (!stored) throw new UserError(UPLOAD_MISSING);

  let contentType: string;
  try {
    contentType = validateVideoMetadata(declaredType, fileSize);
    if (stored.size !== fileSize || stored.size > MAX_CLIP_BYTES) throw new Error(SIZE_MISMATCH);
    if (stored.contentType && mediaType(stored.contentType) !== contentType) {
      throw new Error("Uploaded video type does not match the validated file type.");
    }
  } catch (error) {
    if (!(await keyInUse(key))) await deleteObject(key);
    throw new UserError(error instanceof Error ? error.message : String(error));
  }

  const name = typeof fileName === "string" ? fileName.trim().slice(0, 255) : "";
  return db.transaction(async (tx) => {
    // Takes the key's lock, so two saves of one key take turns and the second finds the first.
    await assertKeysUnused(tx, [key]);
    const [existing] = await tx.select({ id: videoIntake.id }).from(videoIntake).where(eq(videoIntake.storageId, key));
    if (existing) return existing.id;
    const now = Date.now();
    const [entry] = await tx
      .insert(videoIntake)
      .values({
        storageId: key,
        fileName: name || `video.${contentType === "video/mp4" ? "mp4" : "webm"}`,
        contentType,
        fileSize,
        status: "uploaded",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: videoIntake.id });
    // Queued in the transaction, so the worker finds the row.
    await enqueue(TRANSCRIBE_VIDEO, { id: entry.id }, { tx });
    return entry.id;
  });
}

/** One entry, for the page to poll while it transcribes. Null for an unknown or malformed id. */
export async function getIntake(rawId: string | undefined): Promise<VideoIntake | null> {
  const id = parseId(rawId);
  if (!id) return null;
  const [entry] = await db.select().from(videoIntake).where(eq(videoIntake.id, id));
  return entry ?? null;
}

/** The 20 newest entries. */
export async function listRecentIntake(): Promise<VideoIntake[]> {
  return db.select().from(videoIntake).orderBy(desc(videoIntake.createdAt)).limit(20);
}
