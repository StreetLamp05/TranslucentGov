import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as mineRoute } from "@/app/api/posts/mine/route";
import { POST as postsRoute } from "@/app/api/posts/route";
import { db } from "@/server/db";
import { reports, residents } from "@/server/db/schema";
import { MAX_CLIP_BYTES } from "@/server/lib/clipLimit";
import { MAX_VIDEO_FRAMES } from "@/server/lib/postLimits";
import { FRAME_COUNT } from "@/lib/media/constants";
import { api, AT, frames, reportRow, upload } from "./api";
import { enqueuedJobs, putTestObject } from "./fakes";

const post = (token: string, body: Record<string, unknown>) => api(postsRoute, { token, body: { ...AT, ...body } });
const video = async (token: string, n = 6) => ({
  mediaType: "video",
  clipStorageId: await upload(token, "video/mp4", "clip"),
  frameStorageIds: await frames(token, n),
});

describe("POST /api/posts (createReport)", () => {
  it("saves a video post as pending with the defaults and queues screenReport once, in the transaction", async () => {
    const media = await video("a");
    const before = Date.now();
    const { status, body: id } = await post("a", { ...media, description: "  Pothole on Floyd Rd  " });

    expect(status).toBe(200);
    const report = await reportRow(id as string);
    const [resident] = await db.select().from(residents).where(eq(residents.token, "a"));
    expect(report).toMatchObject({
      residentId: resident.id,
      mediaType: "video",
      clipStorageId: media.clipStorageId,
      frameStorageIds: media.frameStorageIds,
      description: "Pothole on Floyd Rd",
      ...AT,
      status: "pending",
      meTooCount: 0,
      revealViews: 0,
      audioMuted: false,
      isSample: false,
    });
    expect(report.createdAt).toBeGreaterThanOrEqual(before);
    expect(report.lastActivityAt).toBe(report.createdAt);
    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId: id }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it("saves a 10-photo post with no clip, and a blank description as none", async () => {
    const frameStorageIds = await frames("a", 10);
    const { body: id } = await post("a", { mediaType: "photos", frameStorageIds, description: "   " });
    const report = await reportRow(id as string);
    expect(report).toMatchObject({ mediaType: "photos", frameStorageIds, status: "pending", clipStorageId: null, description: null });
    expect(enqueuedJobs).toHaveLength(1);
  });

  it("accepts a 280-character description and rejects 281", async () => {
    expect((await post("a", { ...(await video("a")), description: "x".repeat(280) })).status).toBe(200);
    const over = await post("a", { ...(await video("a")), description: "x".repeat(281) });
    expect(over).toEqual({ status: 400, body: { error: "The description can be at most 280 characters." } });
  });

  it("rejects 11 photos, and photos with a clip", async () => {
    expect((await post("a", { mediaType: "photos", frameStorageIds: await frames("a", 11) })).body).toEqual({
      error: "A photo post needs 1 to 10 photos.",
    });
    const withClip = await post("a", {
      mediaType: "photos",
      clipStorageId: await upload("a", "video/mp4"),
      frameStorageIds: await frames("a", 1),
    });
    expect(withClip.body).toEqual({ error: "A photo post can't have a clip." });
  });

  it("rejects a video with no clip, no frames, or more than 6 frames", async () => {
    const { clipStorageId, frameStorageIds } = await video("a", 7);
    expect((await post("a", { mediaType: "video", frameStorageIds: frameStorageIds.slice(0, 6) })).body).toEqual({
      error: "A video post needs its clip.",
    });
    expect((await post("a", { mediaType: "video", clipStorageId, frameStorageIds: [] })).body).toEqual({
      error: "A video post needs 1 to 6 frames.",
    });
    expect((await post("a", { mediaType: "video", clipStorageId, frameStorageIds })).body).toEqual({
      error: "A video post needs 1 to 6 frames.",
    });
  });

  it("accepts a clip of exactly MAX_CLIP_BYTES (25,000,000) and rejects one byte more", async () => {
    const withClip = async (bytes: number) => ({
      mediaType: "video",
      clipStorageId: await upload("a", "video/mp4", new Uint8Array(bytes)),
      frameStorageIds: await frames("a", 1),
    });
    expect((await post("a", await withClip(MAX_CLIP_BYTES))).status).toBe(200);
    const over = await post("a", await withClip(MAX_CLIP_BYTES + 1));
    expect(over.status).toBe(400);
    expect(over.body).toEqual({ error: "That clip is over 25 MB. Try a shorter one." });
  });

  it("keeps the limits the recorder relies on", () => {
    expect(MAX_CLIP_BYTES).toBe(25_000_000);
    expect(FRAME_COUNT).toBeLessThanOrEqual(MAX_VIDEO_FRAMES);
  });

  it("rejects a clip that isn't a video and a frame or photo that isn't an image", async () => {
    const jpeg = await upload("a", "image/jpeg");
    const sixFrames = await frames("a", 6);
    expect((await post("a", { mediaType: "video", clipStorageId: jpeg, frameStorageIds: sixFrames })).body).toEqual({
      error: "The clip isn't a video file.",
    });
    // The presign refuses non-media, so a wrong type can only be an object PUT under another type.
    const sneaky = await upload("a", "image/png");
    putTestObject(sneaky, "%PDF", "application/pdf");
    const clipStorageId = await upload("a", "video/mp4");
    expect((await post("a", { mediaType: "video", clipStorageId, frameStorageIds: [sneaky] })).body).toEqual({
      error: "A photo or frame isn't an image file.",
    });
  });

  it("rejects an upload that never arrived and one that another resident uploaded", async () => {
    const media = await video("a");
    // A key requested but never PUT.
    const { body } = await api((await import("@/app/api/files/route")).POST, { token: "a", body: { contentType: "image/jpeg" } });
    const missing = await post("a", { ...media, frameStorageIds: [...media.frameStorageIds.slice(1), (body as { key: string }).key] });
    expect(missing.body).toEqual({ error: "An uploaded file is missing. Try posting again." });

    // Someone else's key, copied from a public URL, can't go on my report.
    const theirs = await video("b");
    const stolen = await post("a", { ...theirs });
    expect(stolen).toEqual({ status: 400, body: { error: "An uploaded file is missing. Try posting again." } });
    // A key that was never issued at all.
    const forged = await post("a", { ...media, clipStorageId: crypto.randomUUID() });
    expect(forged.status).toBe(400);
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("rejects a missing token or an invalid location, saving and queueing nothing", async () => {
    const media = await video("a");
    expect(await api(postsRoute, { body: { ...AT, ...media } })).toEqual({ status: 401, body: { error: "Missing device token" } });
    expect((await api(postsRoute, { token: "   ", body: { ...AT, ...media } })).status).toBe(401);
    expect((await post("a", { ...media, lat: null })).body).toEqual({ error: "That location isn't valid." });
    expect((await post("a", { ...media, lng: 200 })).body).toEqual({ error: "That location isn't valid." });
    expect((await post("a", { ...media, lat: "33.8" })).body).toEqual({ error: "That location isn't valid." });
    expect(await db.select().from(reports)).toHaveLength(0);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("rejects a malformed body without a 500", async () => {
    expect((await post("a", { mediaType: "video", frameStorageIds: "nope" })).status).toBe(400);
    expect((await post("a", { mediaType: "gif", frameStorageIds: [] })).status).toBe(400);
    expect((await post("a", { mediaType: "photos", frameStorageIds: [1] })).status).toBe(400);
  });
});

describe("GET /api/posts/mine (myReport)", () => {
  const mine = (token: string | undefined, reportId: string) =>
    api(mineRoute, { token, method: "GET", path: `/api/posts/mine?reportId=${reportId}` });

  it("returns the caller's own pending report, without the resident ID", async () => {
    const { body: id } = await post("a", await video("a"));
    const { status, body } = await mine("a", id as string);
    expect(status).toBe(200);
    expect(body).toMatchObject({ _id: id, status: "pending", mediaType: "video" });
    expect(body).not.toHaveProperty("residentId");
    expect((body as { frameUrls: string[] }).frameUrls).toHaveLength(6);
  });

  it("shows the verdict, reason and failed-screening details once they're set", async () => {
    const { body: id } = await post("a", await video("a"));
    await db
      .update(reports)
      .set({ status: "held", verdict: "retake", reason: "A face is visible.", screeningError: "Gemini request failed (500)", screeningRetries: 1 })
      .where(eq(reports.id, id as string));
    expect((await mine("a", id as string)).body).toMatchObject({
      status: "held",
      verdict: "retake",
      reason: "A face is visible.",
      screeningError: "Gemini request failed (500)",
      screeningRetries: 1,
    });
  });

  it("is null for another resident, an unknown or missing token, and a junk or unknown id", async () => {
    const { body: id } = await post("a", await video("a"));
    await post("b", await video("b"));
    expect((await mine("b", id as string)).body).toBeNull();
    expect((await mine("nobody", id as string)).body).toBeNull();
    expect((await mine(undefined, id as string)).body).toBeNull();
    expect(await mine("a", "garbage")).toEqual({ status: 200, body: null });
    expect((await mine("a", crypto.randomUUID())).body).toBeNull();
  });
});

describe("a file another report already uses", () => {
  const FILE_IN_USE = "An uploaded file is already used by another post. Try posting again.";

  it("can't go on a second post, as clip or frame, and the first post keeps its files", async () => {
    const first = await video("a");
    const { body: firstId } = await post("a", first);
    expect(firstId).toEqual(expect.any(String));

    // The same resident, so isUploadedBy passes: only the reuse check stops it.
    const sameClip = await post("a", { ...(await video("a")), clipStorageId: first.clipStorageId });
    expect(sameClip).toEqual({ status: 400, body: { error: FILE_IN_USE } });
    const sameFrame = await post("a", { ...(await video("a")), frameStorageIds: [first.frameStorageIds[0]] });
    expect(sameFrame).toEqual({ status: 400, body: { error: FILE_IN_USE } });
    const photos = await post("a", { mediaType: "photos", frameStorageIds: [first.frameStorageIds[2]] });
    expect(photos.body).toEqual({ error: FILE_IN_USE });

    expect(await db.select().from(reports)).toHaveLength(1);
    expect(enqueuedJobs).toHaveLength(1);
  });

  it("two requests racing on one key save one post", async () => {
    const media = await video("a");
    const results = await Promise.all([post("a", media), post("a", media)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await db.select().from(reports)).toHaveLength(1);
  });
});
