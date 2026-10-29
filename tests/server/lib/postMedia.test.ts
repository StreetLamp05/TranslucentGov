import { describe, expect, it } from "vitest";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { UserError } from "@/server/lib/errors";
import { checkPostMedia } from "@/server/lib/postMedia";
import { CLIP_TOO_BIG } from "@/server/lib/postLimits";
import { statObject } from "@/server/storage";
import { putTestObject } from "../fakes";

// The post-media checks (§4.1.1) against MinIO's stat. The Convex path is covered by
// tests/convex/posts.test.ts and retake.test.ts.

describe("checkPostMedia on MinIO", () => {
  it("accepts a clip plus frames", async () => {
    putTestObject("clip", "v", "video/mp4");
    putTestObject("f1", "i", "image/jpeg");
    await expect(
      checkPostMedia(statObject, { mediaType: "video", clipStorageId: "clip", frameStorageIds: ["f1"] }),
    ).resolves.toBeUndefined();
  });

  it("refuses a missing upload, a wrong type or an oversized clip with a user-facing error", async () => {
    putTestObject("f1", "i", "image/jpeg");
    const missing = checkPostMedia(statObject, { mediaType: "photos", frameStorageIds: ["f1", "gone"] });
    await expect(missing).rejects.toThrow(new UserError("An uploaded file is missing. Try posting again."));

    putTestObject("not-video", "i", "image/png");
    await expect(
      checkPostMedia(statObject, { mediaType: "video", clipStorageId: "not-video", frameStorageIds: ["f1"] }),
    ).rejects.toThrow("The clip isn't a video file.");

    putTestObject("big", new Uint8Array(MAX_CLIP_BYTES + 1), "video/webm");
    await expect(
      checkPostMedia(statObject, { mediaType: "video", clipStorageId: "big", frameStorageIds: ["f1"] }),
    ).rejects.toThrow(CLIP_TOO_BIG);
  });
});
