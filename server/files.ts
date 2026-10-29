import type { Caller } from "./http";
import { UserError } from "./lib/errors";
import { createUploadUrl } from "./storage";

// Step one of an upload (§1.1.1): the browser asks for a key and a presigned PUT URL, PUTs the
// file to MinIO, then saves the key on a report. Residents upload as their device's resident (a
// brand-new device gets its resident row here, so its first upload works); fixers pass `as:
// "fixer"` and need a valid fixer token.
export async function generateUploadUrl(
  caller: Caller,
  { contentType, as }: { contentType: unknown; as?: unknown },
): Promise<{ key: string; url: string }> {
  // Only media: MinIO is served from the app's origin, so an uploaded text/html must never be signed.
  if (typeof contentType !== "string" || !/^(video|image)\/[\w.+-]+$/i.test(contentType)) {
    throw new UserError("Only video and image files can be uploaded.");
  }
  if (as === "fixer") {
    const fixer = await caller.fixer();
    return createUploadUrl(contentType, { kind: "fixer", id: fixer.id });
  }
  return createUploadUrl(contentType, { kind: "resident", id: await caller.resident() });
}
