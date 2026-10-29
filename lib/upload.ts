"use client";

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mutate } from "./data/api";
import { getResidentToken } from "./hooks/useResidentToken";
import { normalizeMimeType } from "./media/mimeType";

// Client side of a Convex upload (§1.1.1): generate a URL, POST the blob, return the storage ID.
//
//   const storageId = await uploadFile(blob);                  // as this device's resident
//   const storageId = await uploadFile(blob, { fixerToken });  // as a fixer

let client: ConvexHttpClient | null = null;
const convex = () => (client ??= new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL as string));

export async function uploadFile(blob: Blob, auth?: { fixerToken: string }): Promise<Id<"_storage">> {
  const url = await convex().mutation(
    api.files.generateUploadUrl,
    auth ? { fixerToken: auth.fixerToken } : { token: getResidentToken() },
  );
  const contentType = normalizeMimeType(blob.type);
  const res = await fetch(url, {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : undefined,
    body: blob,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

// The MinIO upload (§1.1.1) that replaces uploadFile above (US40 deletes that with Convex): ask
// the server for a presigned URL, PUT the blob straight to MinIO, and return the key to save on
// the report. Identity rides in the headers lib/data/api.ts sends; `as` says who is uploading.
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
