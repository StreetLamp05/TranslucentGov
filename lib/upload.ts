"use client";

import { mutate } from "./data/api";
import { normalizeMimeType } from "./media/mimeType";

// The MinIO upload (§1.1.1): ask the server for a presigned URL, PUT the blob straight to MinIO,
// and return the key to save on the report. Identity rides in the headers lib/data/api.ts sends; `as` says who is uploading.
//
//   const key = await uploadMedia(blob);                  // as this device's resident
//   const key = await uploadMedia(blob, { fixerToken });  // as a fixer

export async function uploadMedia(blob: Blob, auth?: { fixerToken: string }): Promise<string> {
  const contentType = normalizeMimeType(blob.type);
  if (!contentType) throw new Error("This file has no type, so it can't be uploaded.");
  const { key, url } = await mutate<{ key: string; url: string }>("/api/files", {
    contentType,
    ...(auth ? { as: "fixer" } : {}),
  });
  // The URL signs this Content-Type, so the PUT must send exactly it.
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return key;
}
