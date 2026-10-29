import { mutate } from "@/lib/data/api";
import { normalizeMimeType } from "@/lib/media/mimeType";

// Client side of a proof upload (§1.1.1): ask for a presigned MinIO URL, PUT the blob to it, and
// return the object key that POST /api/fixes takes. `as` says whose token pays for the URL.

export type UploadAs = "fixer" | "resident";

// For a blob the browser gave no type; the server only accepts video/* and image/*.
const FALLBACK_TYPE = { video: "video/mp4", image: "image/jpeg" } as const;

export async function uploadProof(blob: Blob, as: UploadAs, kind: keyof typeof FALLBACK_TYPE): Promise<string> {
  const contentType = normalizeMimeType(blob.type) || FALLBACK_TYPE[kind];
  const { key, url } = await mutate<{ key: string; url: string }>("/api/fixes/upload-url", { as, contentType });
  // The URL signs this exact Content-Type, so the PUT has to send the same one.
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return key;
}
