import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_CLIP_BYTES } from "../../convex/lib/clipLimit";
import { MAX_VIDEO_FRAMES } from "../../convex/lib/postLimits";
import schema from "../../convex/schema";
import { FRAME_COUNT } from "../../lib/media/constants";
import { modules } from "./setup";

const AT = { lat: 33.8158, lng: -84.5825 };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setup() {
  const t = convexTest(schema, modules);
  const store = (blob: Blob) => t.run((ctx) => ctx.storage.store(blob));
  const jpegs = (n: number) =>
    Promise.all(Array.from({ length: n }, (_, i) => store(new Blob([`frame ${i}`], { type: "image/jpeg" }))));
  const clip = (bytes = 4) => store(new Blob([new Uint8Array(bytes)], { type: "video/mp4" }));
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return { t, jpegs, clip, scheduled };
}

describe("createReport", () => {
  test("saves a valid video post as pending with the defaults and schedules screenReport exactly once", async () => {
    const { t, jpegs, clip, scheduled } = setup();
    const clipStorageId = await clip();
    const frameStorageIds = await jpegs(6);

    const before = Date.now();
    const reportId = await t.mutation(api.posts.createReport, {
      token: "resident-a",
      mediaType: "video",
      clipStorageId,
      frameStorageIds,
      description: "  Pothole on Floyd Rd  ",
      ...AT,
    });

    const report = (await t.run((ctx) => ctx.db.get(reportId)))!;
    const resident = await t.run((ctx) =>
      ctx.db.query("residents").withIndex("by_token", (q) => q.eq("token", "resident-a")).unique(),
    );
    expect(report).toMatchObject({
      residentId: resident!._id,
      mediaType: "video",
      clipStorageId,
      frameStorageIds,
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

    const jobs = await scheduled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: "screening:screenReport", args: [{ reportId }] });
  });

  test("saves a valid photo post with no clip, and a blank description as none", async () => {
    const { t, jpegs, scheduled } = setup();
    const frameStorageIds = await jpegs(10);

    const reportId = await t.mutation(api.posts.createReport, {
      token: "resident-a",
      mediaType: "photos",
      frameStorageIds,
      description: "   ",
      ...AT,
    });

    const report = (await t.run((ctx) => ctx.db.get(reportId)))!;
    expect(report).toMatchObject({ mediaType: "photos", frameStorageIds, status: "pending" });
    expect(report.clipStorageId).toBeUndefined();
    expect(report.description).toBeUndefined();
    expect(await scheduled()).toHaveLength(1);
  });

  test("accepts a 280-character description and rejects 281", async () => {
    const { t, jpegs, clip } = setup();
    const post = async (description: string) =>
      t.mutation(api.posts.createReport, {
        token: "resident-a",
        mediaType: "video",
        clipStorageId: await clip(),
        frameStorageIds: await jpegs(6),
        description,
        ...AT,
      });

    await expect(post("x".repeat(280))).resolves.toBeDefined();
    await expect(post("x".repeat(281))).rejects.toThrow(/at most 280 characters/);
  });

  test("rejects 11 photos, and photos with a clip", async () => {
    const { t, jpegs, clip } = setup();
    await expect(
      t.mutation(api.posts.createReport, { token: "a", mediaType: "photos", frameStorageIds: await jpegs(11), ...AT }),
    ).rejects.toThrow(/1 to 10 photos/);
    await expect(
      t.mutation(api.posts.createReport, {
        token: "a",
        mediaType: "photos",
        clipStorageId: await clip(),
        frameStorageIds: await jpegs(1),
        ...AT,
      }),
    ).rejects.toThrow(/can't have a clip/);
  });

  test("rejects a video with no clip, no frames, or more than 6 frames", async () => {
    const { t, jpegs, clip } = setup();
    const video = (args: { clipStorageId?: Id<"_storage">; frameStorageIds: Id<"_storage">[] }) =>
      t.mutation(api.posts.createReport, { token: "a", mediaType: "video", ...args, ...AT });

    await expect(video({ frameStorageIds: await jpegs(6) })).rejects.toThrow(/needs its clip/);
    await expect(video({ clipStorageId: await clip(), frameStorageIds: [] })).rejects.toThrow(/1 to 6 frames/);
    await expect(video({ clipStorageId: await clip(), frameStorageIds: await jpegs(7) })).rejects.toThrow(
      /1 to 6 frames/,
    );
  });

  test("accepts a clip of exactly MAX_CLIP_BYTES (25,000,000) and rejects one byte more", async () => {
    const { t, jpegs, clip } = setup();
    const post = async (bytes: number) =>
      t.mutation(api.posts.createReport, {
        token: "a",
        mediaType: "video",
        clipStorageId: await clip(bytes),
        frameStorageIds: await jpegs(1),
        ...AT,
      });

    await expect(post(MAX_CLIP_BYTES)).resolves.toBeDefined();
    await expect(post(MAX_CLIP_BYTES + 1)).rejects.toThrow(/over 25 MB/);
  });

  test("the clip limit is 25,000,000 bytes, not 25 MiB", () => {
    expect(MAX_CLIP_BYTES).toBe(25_000_000);
  });

  test("allows every frame the recorder grabs", () => {
    expect(FRAME_COUNT).toBeLessThanOrEqual(MAX_VIDEO_FRAMES);
  });

  test("rejects a clip that isn't a video and a frame or photo that isn't an image, but allows an untyped upload", async () => {
    const { t, jpegs, clip } = setup();
    const pdf = await t.run((ctx) => ctx.storage.store(new Blob(["%PDF"], { type: "application/pdf" })));
    const untyped = await t.run((ctx) => ctx.storage.store(new Blob(["?"])));
    const post = (mediaType: "video" | "photos", clipStorageId: Id<"_storage"> | undefined, frameStorageIds: Id<"_storage">[]) =>
      t.mutation(api.posts.createReport, { token: "a", mediaType, clipStorageId, frameStorageIds, ...AT });

    await expect(post("video", (await jpegs(1))[0], await jpegs(6))).rejects.toThrow(/isn't a video/);
    await expect(post("video", await clip(), [pdf])).rejects.toThrow(/isn't an image/);
    await expect(post("photos", undefined, [...(await jpegs(2)), pdf])).rejects.toThrow(/isn't an image/);
    await expect(post("video", untyped, await jpegs(6))).resolves.toBeDefined();
  });

  test("rejects a deleted upload", async () => {
    const { t, jpegs, clip } = setup();
    const [gone, kept] = await jpegs(2);
    await t.run((ctx) => ctx.storage.delete(gone));
    await expect(
      t.mutation(api.posts.createReport, {
        token: "a",
        mediaType: "video",
        clipStorageId: await clip(),
        frameStorageIds: [kept, gone],
        ...AT,
      }),
    ).rejects.toThrow(/missing/);
  });

  test("rejects a missing token or an invalid location, saving and scheduling nothing", async () => {
    const { t, jpegs, clip, scheduled } = setup();
    const post = async (token: string, lat = AT.lat, lng = AT.lng) =>
      t.mutation(api.posts.createReport, {
        token,
        mediaType: "video",
        clipStorageId: await clip(),
        frameStorageIds: await jpegs(6),
        lat,
        lng,
      });

    await expect(post("")).rejects.toThrow(/Missing device token/);
    await expect(post("   ")).rejects.toThrow(/Missing device token/);
    await expect(post("a", NaN)).rejects.toThrow(/location/);
    await expect(post("a", AT.lat, 200)).rejects.toThrow(/location/);

    expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("residents").collect())).toHaveLength(0);
    expect(await scheduled()).toHaveLength(0);
  });

  test("the scheduled screenReport runs", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // No keys, so screening fails before any network call (tests/convex/screening.test.ts
    // covers the real pipeline with mocks).
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_GEOCODING_KEY", "");
    const { t, jpegs, clip, scheduled } = setup();
    const reportId = await t.mutation(api.posts.createReport, {
      token: "a",
      mediaType: "video",
      clipStorageId: await clip(),
      frameStorageIds: await jpegs(6),
      ...AT,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // The first try and its one retry (§4.2.1).
    expect((await scheduled()).map((s) => s.state.kind)).toEqual(["success", "success"]);
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ status: "held", reason: "screening failed" });
  });
});

describe("myReport", () => {
  async function posted() {
    const { t, jpegs, clip } = setup();
    const reportId = await t.mutation(api.posts.createReport, {
      token: "resident-a",
      mediaType: "video",
      clipStorageId: await clip(),
      frameStorageIds: await jpegs(6),
      description: "Streetlight out",
      ...AT,
    });
    return { t, reportId };
  }

  test("returns the caller's own pending report, without the resident ID", async () => {
    const { t, reportId } = await posted();
    const mine = await t.query(api.posts.myReport, { token: "resident-a", reportId });
    expect(mine).toMatchObject({ _id: reportId, status: "pending", description: "Streetlight out", ...AT });
    expect(mine?.clipUrl).toEqual(expect.any(String));
    expect(mine?.frameUrls).toHaveLength(6);
    expect(mine).not.toHaveProperty("residentId");
  });

  test("shows the verdict and reason once screening sets them", async () => {
    const { t, reportId } = await posted();
    await t.run((ctx) => ctx.db.patch(reportId, { status: "held", verdict: "retake", reason: "A face is visible" }));
    expect(await t.query(api.posts.myReport, { token: "resident-a", reportId })).toMatchObject({
      status: "held",
      verdict: "retake",
      reason: "A face is visible",
    });
  });

  test("shows the poster a failed screening's error and Try again count (US14)", async () => {
    const { t, reportId } = await posted();
    await t.run((ctx) =>
      ctx.db.patch(reportId, {
        status: "held",
        reason: "screening failed",
        screeningError: "Gemini request failed (500)",
        screeningRetries: 1,
      }),
    );
    expect(await t.query(api.posts.myReport, { token: "resident-a", reportId })).toMatchObject({
      reason: "screening failed",
      screeningError: "Gemini request failed (500)",
      screeningRetries: 1,
    });
  });

  test("returns null for another resident's token, an unknown token or an empty one", async () => {
    const { t, reportId } = await posted();
    // A second resident who has posted, so their token resolves to a real resident.
    await t.mutation(api.files.generateUploadUrl, { token: "resident-b" });

    expect(await t.query(api.posts.myReport, { token: "resident-b", reportId })).toBeNull();
    expect(await t.query(api.posts.myReport, { token: "never-seen", reportId })).toBeNull();
    expect(await t.query(api.posts.myReport, { token: "", reportId })).toBeNull();
  });
});
