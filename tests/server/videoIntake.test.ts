import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as samplesPost } from "@/app/api/admin/samples/route";
import { GET as intakeGet, POST as intakeSave } from "@/app/api/admin/video-intake/route";
import { db } from "@/server/db";
import { videoIntake, type VideoIntake } from "@/server/db/schema";
import { transcribeVideo } from "@/server/jobs/transcribeVideo";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { FILE_IN_USE } from "@/server/posts";
import { adminApi, adminUpload, loginAdmin } from "./admin";
import { upload } from "./api";
import { enqueuedJobs, objects, putTestObject } from "./fakes";

// The admin video intake (/admin/video-intake), ported from convex/videoIntake.test.ts, and the
// transcribeVideo job (Gemini).

const { transcribe } = vi.hoisted(() => ({ transcribe: vi.fn() }));
vi.mock("@/server/lib/transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/lib/transcribe")>()),
  transcribe,
}));

const SEGMENTS = [{ start: 0, end: 1.5, text: "Testing one two." }];

beforeEach(() => {
  transcribe.mockReset().mockResolvedValue({ text: "Testing one two.", segments: SEGMENTS });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const save = (token: string | null, body: Record<string, unknown>) =>
  adminApi(token, intakeSave, { body });
const get = (token: string, id: string) => adminApi(token, intakeGet, { method: "GET", path: `/api/admin/video-intake?id=${id}` });

async function uploaded(token: string, bytes = "clip bytes", contentType = "video/mp4") {
  const key = await adminUpload(token, contentType, bytes);
  return { key, fileName: "clip.mp4", contentType, fileSize: new TextEncoder().encode(bytes).byteLength };
}

describe("saveUpload (POST /api/admin/video-intake)", () => {
  it("saves the entry as uploaded and queues transcribeVideo in the same transaction", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);

    const { status, body: id } = await save(token, input);

    expect(status).toBe(200);
    const [row] = await db.select().from(videoIntake);
    expect(row).toMatchObject({
      id,
      storageId: input.key,
      fileName: "clip.mp4",
      contentType: "video/mp4",
      fileSize: input.fileSize,
      status: "uploaded",
    });
    expect(enqueuedJobs).toEqual([
      { name: "transcribeVideo", payload: { id }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it("names an unnamed clip after its type and trims long names", async () => {
    const token = await loginAdmin();
    await save(token, { ...(await uploaded(token, "a", "video/webm")), fileName: "   " });
    await save(token, { ...(await uploaded(token, "b")), fileName: "x".repeat(300) });
    const rows = await db.select().from(videoIntake).orderBy(videoIntake.creationTime);
    expect(rows.map((r) => r.fileName)).toEqual(["video.webm", "x".repeat(255)]);
  });

  it("checks the stored file's size instead of trusting the client", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);

    const { status, body } = await save(token, { ...input, fileSize: 999 });

    expect(status).toBe(400);
    expect(body).toEqual({ error: "Uploaded video size does not match the validated file size." });
    expect(await db.select().from(videoIntake)).toHaveLength(0);
    expect(objects.has(input.key)).toBe(false); // a rejected upload is deleted
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("refuses a file over 25 MB, and a type the stored object doesn't have", async () => {
    const token = await loginAdmin();
    const big = await adminUpload(token, "video/mp4", new Uint8Array(MAX_CLIP_BYTES + 1));
    expect((await save(token, { key: big, fileName: "big.mp4", contentType: "video/mp4", fileSize: MAX_CLIP_BYTES + 1 })).status).toBe(400);
    expect(objects.has(big)).toBe(false);

    const input = await uploaded(token);
    const { status, body } = await save(token, { ...input, contentType: "video/webm" });
    expect(status).toBe(400);
    expect(body).toEqual({ error: "Uploaded video type does not match the validated file type." });
    expect(objects.has(input.key)).toBe(false);
  });

  it("refuses anything but MP4 and WebM", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token, "mov", "video/quicktime");
    const { status, body } = await save(token, input);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "Only MP4 and WebM videos can be uploaded." });
    expect(objects.has(input.key)).toBe(false);
  });

  it("refuses a key the admin didn't upload, and leaves that object alone", async () => {
    const token = await loginAdmin();
    const residentKey = await upload("resident", "video/mp4", "theirs");
    const { status } = await save(token, { key: residentKey, fileName: "x.mp4", contentType: "video/mp4", fileSize: 6 });
    expect(status).toBe(400);
    expect(objects.has(residentKey)).toBe(true);

    const missing = await save(token, { key: crypto.randomUUID(), fileName: "x.mp4", contentType: "video/mp4", fileSize: 1 });
    expect(missing.status).toBe(400);
    expect(await db.select().from(videoIntake)).toHaveLength(0);
  });

  it("refuses a malformed body", async () => {
    const token = await loginAdmin();
    for (const body of [{}, { key: "k" }, { key: 5, contentType: "video/mp4", fileSize: 1 }, { key: "k", contentType: "video/mp4", fileSize: "1" }]) {
      expect((await save(token, body)).status).toBe(400);
    }
  });

  it("saving the same upload twice returns the first entry and queues one job", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);
    const first = await save(token, input);
    const second = await save(token, input);
    expect(second.body).toBe(first.body);
    expect(await db.select().from(videoIntake)).toHaveLength(1);
    expect(enqueuedJobs).toHaveLength(1);
  });

  it("won't take, or delete, a file a sample or an earlier entry already uses", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);
    const first = await save(token, input);

    // The same key with a wrong size is rejected, but the first entry keeps its video.
    const wrong = await save(token, { ...input, fileSize: 9 });
    expect(wrong.status).toBe(400);
    expect(objects.has(input.key)).toBe(true);
    expect((await get(token, first.body as string)).body).toMatchObject({ status: "uploaded" });

    // A seeded sample's clip can't become an intake entry either.
    const clip = await adminUpload(token, "video/mp4", "sample clip");
    const frame = await adminUpload(token, "image/jpeg");
    const seeded = await adminApi(token, samplesPost, { body: { samples: [{ mediaType: "video", clipStorageId: clip, frameStorageIds: [frame], lat: 33.8, lng: -84.5 }] } });
    expect(seeded.status).toBe(200);
    const taken = await save(token, { key: clip, fileName: "c.mp4", contentType: "video/mp4", fileSize: 11 });
    expect(taken).toEqual({ status: 400, body: { error: FILE_IN_USE } });
    expect((await save(token, { key: clip, fileName: "c.mp4", contentType: "video/mp4", fileSize: 1 })).status).toBe(400);
    expect(objects.has(clip)).toBe(true);
    expect(await db.select().from(videoIntake)).toHaveLength(1);
  });

  it("a sample can't be seeded from a file an intake entry holds", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);
    await save(token, input);
    const frame = await adminUpload(token, "image/jpeg");
    const seeded = await adminApi(token, samplesPost, { body: { samples: [{ mediaType: "video", clipStorageId: input.key, frameStorageIds: [frame], lat: 33.8, lng: -84.5 }] } });
    expect(seeded).toEqual({ status: 400, body: { error: FILE_IN_USE } });
  });

  it("needs an admin session", async () => {
    const token = await loginAdmin();
    const input = await uploaded(token);
    expect((await save(null, input)).status).toBe(401);
    expect(await db.select().from(videoIntake)).toHaveLength(0);
  });
});

describe("reading entries", () => {
  it("returns one entry by id (null if unknown or malformed) and the 20 newest without one", async () => {
    const token = await loginAdmin();
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push((await save(token, await uploaded(token, `clip ${i}`))).body as string);

    expect((await get(token, ids[3])).body).toMatchObject({ id: ids[3], status: "uploaded" });
    expect(await get(token, crypto.randomUUID())).toEqual({ status: 200, body: null });
    expect(await get(token, "garbage")).toEqual({ status: 200, body: null });

    const recent = await adminApi(token, intakeGet, { method: "GET", path: "/api/admin/video-intake" });
    expect((recent.body as VideoIntake[]).map((e) => e.id)).toEqual(ids.slice(2).reverse());
  });

  it("needs an admin session", async () => {
    expect((await adminApi("nope", intakeGet, { method: "GET", path: "/api/admin/video-intake" })).status).toBe(401);
  });
});

describe("transcribeVideo job", () => {
  async function entry(overrides: Partial<VideoIntake> = {}) {
    const key = crypto.randomUUID();
    putTestObject(key, "video bytes", "video/mp4");
    const now = Date.now();
    const [row] = await db
      .insert(videoIntake)
      .values({ storageId: key, fileName: "clip.mp4", contentType: "video/mp4", fileSize: 11, status: "uploaded", createdAt: now, updatedAt: now, ...overrides })
      .returning();
    return row;
  }
  const load = async (id: string) => (await db.select().from(videoIntake).where(eq(videoIntake.id, id)))[0];

  it("transcribes the stored video and saves the transcript", async () => {
    const row = await entry();

    await transcribeVideo({ id: row.id });

    const [blob, contentType, fileName] = transcribe.mock.calls[0] as [Blob, string, string];
    expect(await blob.text()).toBe("video bytes");
    expect([blob.type, contentType, fileName]).toEqual(["video/mp4", "video/mp4", "clip.mp4"]);
    expect(await load(row.id)).toMatchObject({ status: "complete", transcript: "Testing one two.", segments: SEGMENTS, error: null });
  });

  it("saves a failure on the entry, trimmed, instead of throwing", async () => {
    transcribe.mockRejectedValue(new Error("x".repeat(1500)));
    const row = await entry();

    await expect(transcribeVideo({ id: row.id })).resolves.toBeUndefined();

    const saved = await load(row.id);
    expect(saved.status).toBe("failed");
    expect(saved.error).toBe("x".repeat(1000));
  });

  it("fails when the object is missing from MinIO", async () => {
    const row = await entry({ storageId: "gone" });
    await transcribeVideo({ id: row.id });
    expect(await load(row.id)).toMatchObject({ status: "failed" });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("runs again on a failed entry, but not on one that's transcribing or done", async () => {
    const failed = await entry({ status: "failed", error: "old" });
    await transcribeVideo({ id: failed.id });
    expect(await load(failed.id)).toMatchObject({ status: "complete", error: null });

    for (const status of ["transcribing", "complete"] as const) {
      const row = await entry({ status });
      transcribe.mockClear();
      await transcribeVideo({ id: row.id });
      expect(transcribe).not.toHaveBeenCalled();
      expect((await load(row.id)).status).toBe(status);
    }
  });

  it("does nothing for an entry that was purged", async () => {
    await expect(transcribeVideo({ id: crypto.randomUUID() })).resolves.toBeUndefined();
    expect(transcribe).not.toHaveBeenCalled();
  });
});
