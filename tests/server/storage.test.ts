import { NoSuchKey } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { uploads } from "@/server/db/schema";
import {
  createUploadUrl,
  deleteObject,
  getDownloadUrl,
  isUploadedBy,
  readObject,
  statObject,
} from "@/server/storage";
import { objects, putTestObject } from "./fakes";

// Signing is local, and MinIO is the in-memory fake (tests/server/fakes.ts). The round trip
// against a real MinIO is in the US33 verification notes (tasks/US33-todo.md).

const resident = { kind: "resident", id: "00000000-0000-4000-8000-000000000001" } as const;
const otherResident = { kind: "resident", id: "00000000-0000-4000-8000-000000000002" } as const;

describe("server/storage", () => {
  it("signs uploads for the public URL, with the content type and no body checksum", async () => {
    const { key, url } = await createUploadUrl("video/mp4", resident);
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://govtok.test");
    expect(parsed.pathname).toBe(`/govtok/${key}`);
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect([...parsed.searchParams.keys()].some((name) => name.toLowerCase().includes("checksum"))).toBe(false);
  });

  it("gives every upload a new key", async () => {
    const [a, b] = await Promise.all([createUploadUrl("image/jpeg", resident), createUploadUrl("image/jpeg", resident)]);
    expect(a.key).not.toBe(b.key);
  });

  it("records who asked for each key, so a key copied from a public URL proves nothing (§8)", async () => {
    const { key } = await createUploadUrl("video/mp4", resident);

    expect(await isUploadedBy(key, resident)).toBe(true);
    expect(await isUploadedBy(key, otherResident)).toBe(false);
    expect(await isUploadedBy(key, { kind: "fixer", id: resident.id })).toBe(false);
    expect(await isUploadedBy(key, { kind: "admin" })).toBe(false);
    expect(await isUploadedBy("never-issued", resident)).toBe(false);

    const admin = await createUploadUrl("video/mp4", { kind: "admin" });
    expect(await isUploadedBy(admin.key, { kind: "admin" })).toBe(true);
    expect(await isUploadedBy(admin.key, resident)).toBe(false);
  });

  it("keeps a download URL stable within the hour, so polling doesn't reload a playing video", async () => {
    const hour = Date.UTC(2026, 9, 30, 13);
    const first = await getDownloadUrl("clip", hour + 60_000);
    expect(await getDownloadUrl("clip", hour + 59 * 60_000)).toBe(first);
    expect(await getDownloadUrl("clip", hour + 61 * 60_000)).not.toBe(first);
    expect(new URL(first).pathname).toBe("/govtok/clip");
  });

  it("stats and reads an uploaded object, and returns null for a missing one", async () => {
    const { key } = await createUploadUrl("video/webm", resident);
    putTestObject(key, "clip bytes", "video/webm");

    expect(await statObject(key)).toEqual({ size: 10, contentType: "video/webm" });
    expect(new TextDecoder().decode(await readObject(key))).toBe("clip bytes");
    expect(await statObject("missing")).toBeNull();
    await expect(readObject("missing")).rejects.toBeInstanceOf(NoSuchKey); // what MinIO throws on GET
  });

  it("deletes the object and its uploads row; a missing key is fine", async () => {
    const { key } = await createUploadUrl("video/webm", resident);
    putTestObject(key, "clip bytes", "video/webm");

    await deleteObject(key);
    expect(objects.has(key)).toBe(false);
    expect(await db.select().from(uploads).where(eq(uploads.key, key))).toEqual([]);
    await expect(deleteObject("missing")).resolves.toBeUndefined();
  });
});
