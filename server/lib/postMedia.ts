import { MAX_CLIP_BYTES } from "./clipLimit";
import { UserError } from "./errors";
import { CLIP_TOO_BIG, MAX_PHOTOS, MAX_VIDEO_FRAMES } from "./postLimits";

/** An uploaded file's size and type, or null when there is no such upload. */
export type StoredFile = { size: number; contentType?: string | null } | null;

// A post's media (§4.1.1), checked the same way for a new post (createReport) and a retake
// (retakeReport, §4.2.1): a video is a clip plus 1–6 frames, a slideshow is 1–10 photos and no clip.
// `stat` looks an upload up by key: server/storage.ts `statObject`, or M0's `db.system.get`.
export async function checkPostMedia(
  stat: (key: string) => Promise<StoredFile>,
  {
    mediaType,
    clipStorageId,
    frameStorageIds: frames,
  }: { mediaType: "video" | "photos"; clipStorageId?: string | null; frameStorageIds: string[] },
): Promise<void> {
  if (mediaType === "video") {
    if (!clipStorageId) throw new UserError("A video post needs its clip.");
    if (frames.length < 1 || frames.length > MAX_VIDEO_FRAMES) {
      throw new UserError(`A video post needs 1 to ${MAX_VIDEO_FRAMES} frames.`);
    }
    const clipSize = await storedSize(stat, clipStorageId, "video");
    if (clipSize > MAX_CLIP_BYTES) throw new UserError(CLIP_TOO_BIG);
  } else {
    if (clipStorageId) throw new UserError("A photo post can't have a clip.");
    if (frames.length < 1 || frames.length > MAX_PHOTOS) {
      throw new UserError(`A photo post needs 1 to ${MAX_PHOTOS} photos.`);
    }
  }
  await Promise.all(frames.map((key) => storedSize(stat, key, "image")));
}

// Throws unless the upload exists and is the right kind of file. An upload sent without a
// Content-Type has no type to check, so only a wrong type is refused.
async function storedSize(
  stat: (key: string) => Promise<StoredFile>,
  key: string,
  kind: "video" | "image",
): Promise<number> {
  const file = await stat(key);
  if (!file) throw new UserError("An uploaded file is missing. Try posting again.");
  if (file.contentType && !file.contentType.startsWith(`${kind}/`)) {
    throw new UserError(kind === "video" ? "The clip isn't a video file." : "A photo or frame isn't an image file.");
  }
  return file.size;
}
