import { describe, expect, it } from "vitest";
import { POST as retakeRoute } from "@/app/api/retake/route";
import { POST as retryRoute } from "@/app/api/retake/retry/route";
import { db } from "@/server/db";
import { uploads, type Report } from "@/server/db/schema";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "@/server/lib/screening";
import { api, frames, insertReport, reportRow, upload } from "./api";
import { enqueuedJobs, objects } from "./fakes";

// A held report by "poster" with real uploads: a clip and 2 frames (or 2 photos).
async function held(fields: Partial<typeof import("@/server/db/schema").reports.$inferInsert> = {}) {
  const mediaType = fields.mediaType ?? "video";
  const clipStorageId = mediaType === "video" ? await upload("poster", "video/mp4", "old clip") : undefined;
  const report = await insertReport("poster", {
    mediaType,
    clipStorageId,
    frameStorageIds: await frames("poster", 2),
    category: "pothole",
    owner: "cobb",
    agency: "Cobb DOT",
    title: "Deep pothole",
    transcript: "Old narration.",
    segments: [{ start: 0, end: 1, text: "Old narration." }],
    segmentsEs: [{ start: 0, end: 1, text: "Narración anterior." }],
    status: "held",
    verdict: "retake",
    reason: "A face is visible.",
    createdAt: 1,
    ...fields,
  });
  await upload("someone-else", "image/jpeg"); // makes the other resident exist
  enqueuedJobs.length = 0;
  return report;
}

const newVideo = async (token = "poster") => ({
  mediaType: "video",
  clipStorageId: await upload(token, "video/mp4", "new clip"),
  frameStorageIds: await frames(token, 3),
});
const retake = (token: string | undefined, reportId: unknown, media: Record<string, unknown>) =>
  api(retakeRoute, { token, body: { reportId, ...media } });
const retry = (token: string | undefined, reportId: unknown) => api(retryRoute, { token, body: { reportId } });
const oldKeys = (r: Report) => [r.clipStorageId, ...r.frameStorageIds].filter((k): k is string => !!k);

describe("POST /api/retake (retakeReport)", () => {
  it("swaps in the new files, clears the verdict, goes pending, deletes the old files and queues screening", async () => {
    // Every field the retake has to clear starts set.
    const old = await held({ screeningError: "Gemini request failed (500)", audioMuted: true });
    const media = await newVideo();

    expect(await retake("poster", old.id, media)).toEqual({ status: 200, body: null });

    const report = await reportRow(old.id);
    expect(report).toMatchObject({ status: "pending", clipStorageId: media.clipStorageId, frameStorageIds: media.frameStorageIds });
    for (const field of ["verdict", "reason", "category", "owner", "agency", "title", "transcript", "segments", "segmentsEs", "screeningError"] as const) {
      expect(report[field]).toBeNull();
    }
    expect(report.audioMuted).toBe(false);
    // Same report: days open still count from the first post.
    expect(report.createdAt).toBe(1);
    for (const key of oldKeys(old)) {
      expect(objects.has(key)).toBe(false);
      expect(await db.select().from(uploads).then((rows) => rows.some((row) => row.key === key))).toBe(false);
    }
    for (const key of [media.clipStorageId, ...media.frameStorageIds]) expect(objects.has(key)).toBe(true);
    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId: old.id }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it("replaces the photos on a photo post", async () => {
    const old = await held({ mediaType: "photos" });
    const frameStorageIds = [await upload("poster", "image/jpeg", "photo")];
    expect((await retake("poster", old.id, { mediaType: "photos", frameStorageIds })).status).toBe(200);
    expect(await reportRow(old.id)).toMatchObject({ status: "pending", mediaType: "photos", frameStorageIds, clipStorageId: null });
    for (const key of oldKeys(old)) expect(objects.has(key)).toBe(false);
  });

  it.each([
    ["another resident", "someone-else"],
    ["an unknown token", "nobody"],
  ])("rejects %s and changes nothing", async (_, token) => {
    const old = await held();
    expect(await retake(token, old.id, await newVideo(token))).toEqual({
      status: 400,
      body: { error: "We couldn't find this post." },
    });
    expect(await reportRow(old.id)).toEqual(old);
    for (const key of oldKeys(old)) expect(objects.has(key)).toBe(true);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("is a 401 without a token and 'not found' for a junk or unknown id", async () => {
    const old = await held();
    expect((await retake(undefined, old.id, await newVideo())).status).toBe(401);
    for (const id of ["garbage", crypto.randomUUID(), null, 5]) {
      expect(await retake("poster", id, await newVideo())).toEqual({ status: 400, body: { error: "We couldn't find this post." } });
    }
  });

  it.each(["reject", "emergency"] as const)("rejects a report held as %s", async (verdict) => {
    const old = await held({ verdict });
    expect((await retake("poster", old.id, await newVideo())).body).toEqual({ error: "This post can't be retaken." });
    expect((await reportRow(old.id)).status).toBe("held");
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("rejects a held report with no verdict (screening failed)", async () => {
    const old = await held({ verdict: null, reason: SCREENING_FAILED_REASON });
    expect((await retake("poster", old.id, await newVideo())).body).toEqual({ error: "This post can't be retaken." });
  });

  it.each(["pending", "open", "fixed"] as const)("rejects a %s report even with a retake verdict", async (status) => {
    const old = await held({ status });
    expect((await retake("poster", old.id, await newVideo())).body).toEqual({ error: "This post can't be retaken." });
    expect((await reportRow(old.id)).status).toBe(status);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("refuses a different format: a video post is retaken as a video", async () => {
    const old = await held();
    const photos = { mediaType: "photos", frameStorageIds: await frames("poster", 1) };
    expect((await retake("poster", old.id, photos)).body).toEqual({ error: "Record a new video for this post." });
    const photoPost = await held({ mediaType: "photos" });
    expect((await retake("poster", photoPost.id, await newVideo())).body).toEqual({ error: "Pick new photos for this post." });
    expect((await reportRow(old.id)).status).toBe("held");
    for (const key of oldKeys(old)) expect(objects.has(key)).toBe(true);
  });

  it("starts a fresh Try again count", async () => {
    const old = await held({ screeningRetries: MAX_SCREENING_RETRIES });
    await retake("poster", old.id, await newVideo());
    expect((await reportRow(old.id)).screeningRetries).toBeNull();
  });

  it("refuses to reuse an old file, which it would otherwise delete", async () => {
    const old = await held();
    const media = await newVideo();
    const reused = { ...media, frameStorageIds: [old.frameStorageIds[0], ...media.frameStorageIds] };
    expect((await retake("poster", old.id, reused)).body).toEqual({ error: "A retake needs new files." });
    expect(objects.has(old.frameStorageIds[0])).toBe(true);
  });

  it("checks the new media like a new post, including who uploaded it", async () => {
    const old = await held();
    const media = await newVideo();
    expect((await retake("poster", old.id, { ...media, clipStorageId: undefined })).body).toEqual({ error: "A video post needs its clip." });
    expect((await retake("poster", old.id, { ...media, frameStorageIds: [media.clipStorageId] })).body).toEqual({
      error: "A photo or frame isn't an image file.",
    });
    // Another resident's upload can't be saved on this report.
    const theirs = await newVideo("someone-else");
    expect((await retake("poster", old.id, theirs)).body).toEqual({ error: "An uploaded file is missing. Try posting again." });
    expect((await reportRow(old.id)).status).toBe("held");
    for (const key of oldKeys(old)) expect(objects.has(key)).toBe(true);
  });

  it("refuses a file another report already uses, so deleting this report's files can't take it", async () => {
    const mine = await held();
    const other = await insertReport("poster", { frameStorageIds: await frames("poster", 1), status: "open" });
    const media = await newVideo();
    const shared = { ...media, frameStorageIds: [other.frameStorageIds[0], ...media.frameStorageIds] };
    expect((await retake("poster", mine.id, shared)).body).toEqual({
      error: "An uploaded file is already used by another post. Try posting again.",
    });
    expect(await reportRow(mine.id)).toEqual(mine);
    expect(objects.has(other.frameStorageIds[0])).toBe(true);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("two retakes at once swap once and queue one job", async () => {
    const old = await held();
    const results = await Promise.all([retake("poster", old.id, await newVideo()), retake("poster", old.id, await newVideo())]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(enqueuedJobs).toHaveLength(1);
  });
});

describe("POST /api/retake/retry (retryScreening)", () => {
  // What markFailed leaves (§4.2.1): held, no verdict.
  const failed = (fields: Parameters<typeof held>[0] = {}) =>
    held({ verdict: null, reason: SCREENING_FAILED_REASON, screeningError: "Gemini request failed (500)", ...fields });

  it("puts the owner's failed report back to pending with the same files and queues screening", async () => {
    const before = await failed();
    expect(await retry("poster", before.id)).toEqual({ status: 200, body: null });

    const report = await reportRow(before.id);
    expect(report).toMatchObject({ status: "pending", reason: null, screeningError: null, screeningRetries: 1 });
    expect(report.clipStorageId).toBe(before.clipStorageId);
    expect(report.frameStorageIds).toEqual(before.frameStorageIds);
    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId: before.id }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it("allows 2 Try agains, then refuses", async () => {
    expect(MAX_SCREENING_RETRIES).toBe(2);
    const report = await failed({ screeningRetries: MAX_SCREENING_RETRIES - 1 });
    expect((await retry("poster", report.id)).status).toBe(200);
    expect((await reportRow(report.id)).screeningRetries).toBe(MAX_SCREENING_RETRIES);

    // Screening fails again.
    const { reports } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(reports).set({ status: "held", reason: SCREENING_FAILED_REASON }).where(eq(reports.id, report.id));
    expect((await retry("poster", report.id)).body).toEqual({ error: "We've already tried checking this post again." });
    expect((await reportRow(report.id)).status).toBe("held");
    expect(enqueuedJobs).toHaveLength(1);
  });

  it("counts two taps at once once", async () => {
    const report = await failed();
    const results = await Promise.all([retry("poster", report.id), retry("poster", report.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await reportRow(report.id)).screeningRetries).toBe(1);
    expect(enqueuedJobs).toHaveLength(1);
  });

  it.each([
    ["another resident", "someone-else"],
    ["an unknown token", "nobody"],
  ])("rejects %s", async (_, token) => {
    const report = await failed();
    expect((await retry(token, report.id)).body).toEqual({ error: "We couldn't find this post." });
    expect((await reportRow(report.id)).status).toBe("held");
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("is a 401 without a token and 'not found' for a junk id", async () => {
    const report = await failed();
    expect((await retry(undefined, report.id)).status).toBe(401);
    expect((await retry("poster", "garbage")).body).toEqual({ error: "We couldn't find this post." });
  });

  it.each([
    ["held as retake", { verdict: "retake" as const, reason: "A face is visible." }],
    ["held as reject", { verdict: "reject" as const, reason: "Not a public-space problem." }],
    ["held as emergency", { verdict: "emergency" as const, reason: "Downed power line." }],
    ["pending", { status: "pending" as const, reason: SCREENING_FAILED_REASON }],
    ["open", { status: "open" as const, verdict: "pass" as const, reason: "Looks fine." }],
  ])("rejects a report that's %s", async (_, fields) => {
    const report = await held(fields);
    expect((await retry("poster", report.id)).body).toEqual({ error: "This post isn't waiting on a failed check." });
    expect(await reportRow(report.id)).toEqual(report);
    expect(enqueuedJobs).toHaveLength(0);
  });
});
