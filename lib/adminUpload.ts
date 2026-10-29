"use client";

import { mutate } from "./data/api";
import { normalizeMimeType } from "./media/mimeType";

// The admin pages' MinIO upload (§1.1.1), as lib/upload.ts `uploadMedia` is for residents: ask
// for a presigned URL (needs the admin session lib/data/api.ts sends), PUT the blob straight to
// MinIO, and return the key to save.
export async function uploadAdminMedia(blob: Blob): Promise<string> {
  const contentType = normalizeMimeType(blob.type);
  if (!contentType) throw new Error("This file has no type, so it can't be uploaded.");
  const { key, url } = await mutate<{ key: string; url: string }>("/api/admin/upload-url", { contentType });
  // The URL signs this Content-Type, so the PUT must send exactly it.
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return key;
}
