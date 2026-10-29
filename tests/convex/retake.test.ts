import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { MAX_SCREENING_RETRIES, SCREENING_FAILED_REASON } from "../../server/lib/screening";
import schema from "../../convex/schema";
import { modules } from "./setup";

const { screenPost, transcribe } = vi.hoisted(() => ({ screenPost: vi.fn(), transcribe: vi.fn() }));

vi.mock("../../convex/lib/screenPrompt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../convex/lib/screenPrompt")>()),
  screenPost,
}));
vi.mock("../../convex/lib/transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../convex/lib/transcribe")>()),
  transcribe,
}));

const AT = { lat: 33.8158, lng: -84.5825 };
const image = (bytes: string) => new Blob([bytes], { type: "image/jpeg" });
const video = (bytes: string) => new Blob([bytes], { type: "video/webm" });

beforeEach(() => {
  screenPost.mockReset();
  transcribe.mockReset().mockResolvedValue({ text: "", segments: [] });
  // No geocoding key, so screening skips the street lookup.
  vi.stubEnv("GOOGLE_GEOCODING_KEY", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Fields = Partial<
  Pick<
    Doc<"reports">,
    "status" | "verdict" | "reason" | "mediaType" | "screeningError" | "screeningRetries" | "audioMuted"
  >
>;

// A held retake report by "poster", with a clip and 2 frames (or 2 photos).
async function setup(fields: Fields = {}) {
  const t = convexTest(schema, modules);
  const {
    status = "held",
    reason = "A face is visible.",
    mediaType = "video",
    screeningError,
    screeningRetries,
    audioMuted = false,
  } = fields;
  // An explicit `verdict: undefined` means none, as after "screening failed".
  const verdict = "verdict" in fields ? fields.verdict : "retake";
  const reportId = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    await ctx.db.insert("residents", { token: "someone-else", createdAt: 1 });
    return await ctx.db.insert("reports", {
      residentId,
      mediaType,
      clipStorageId: mediaType === "video" ? await ctx.storage.store(video("old clip")) : undefined,
      frameStorageIds: [await ctx.storage.store(image("old 1")), await ctx.storage.store(image("old 2"))],
      ...AT,
      category: "pothole",
      owner: "cobb",
      agency: "Cobb DOT",
      title: "Deep pothole",
      transcript: "Old narration.",
      segments: [{ start: 0, end: 1, text: "Old narration." }],
      status,
      verdict,
      reason,
      screeningError,
      screeningRetries,
      audioMuted,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
  });
  const store = (blob: Blob) => t.run((ctx) => ctx.storage.store(blob));
  const read = () => t.run(async (ctx) => (await ctx.db.get(reportId))!);
  const exists = (id: Id<"_storage">) => t.run(async (ctx) => (await ctx.storage.get(id)) !== null);
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const newVideo = async () => ({
    mediaType: "video" as const,
    clipStorageId: await store(video("new clip")),
    frameStorageIds: [await store(image("new 1")), await store(image("new 2")), await store(image("new 3"))],
  });
  return { t, reportId, read, exists, scheduled, store, newVideo };
}

describe("retakeReport", () => {
  test("swaps in the new files, clears the verdict, goes pending, deletes the old files and reschedules screening", async () => {
    // Every field the retake has to clear starts set.
    const { t, reportId, read, exists, scheduled, newVideo } = await setup({
      screeningError: "Claude request failed (500)",
      audioMuted: true,
    });
    const old = await read();
    const media = await newVideo();

    await t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...media });

    const report = await read();
    expect(report).toMatchObject({ status: "pending", ...media });
    // Nothing from the old clip's screening is left on the report.
    const cleared = ["verdict", "reason", "category", "owner", "agency", "title", "transcript", "segments", "screeningError"] as const;
    for (const field of cleared) {
      expect(report[field]).toBeUndefined();
    }
    expect(report.audioMuted).toBe(false);
    // Same report: days open still count from the first post.
    expect(report.createdAt).toBe(1);
    for (const id of [old.clipStorageId!, ...old.frameStorageIds]) expect(await exists(id)).toBe(false);
    for (const id of [media.clipStorageId, ...media.frameStorageIds]) expect(await exists(id)).toBe(true);
    const jobs = await scheduled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: "screening:screenReport", args: [{ reportId }] });
  });

  test("the rescheduled screening lands its verdict on the new files", async () => {
    vi.useFakeTimers();
    screenPost.mockResolvedValue({ verdict: "pass", reason: "Looks fine.", category: "pothole", title: "Deep pothole" });
    const { t, reportId, read, newVideo } = await setup();
    const media = await newVideo();
    await t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...media });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(screenPost.mock.calls[0][0].images).toHaveLength(3);
    expect(await read()).toMatchObject({ status: "open", verdict: "pass", ...media });
  });

  test("a photo retake replaces the photos", async () => {
    const { t, reportId, read, exists, store } = await setup({ mediaType: "photos" });
    const old = await read();
    const frameStorageIds = [await store(image("photo"))];

    await t.mutation(api.retake.retakeReport, { token: "poster", reportId, mediaType: "photos", frameStorageIds });

    expect(await read()).toMatchObject({ status: "pending", mediaType: "photos", frameStorageIds });
    for (const id of old.frameStorageIds) expect(await exists(id)).toBe(false);
  });

  test.each([
    ["another resident", "someone-else"],
    ["an unknown token", "nobody"],
  ])("rejects %s and changes nothing", async (_, token) => {
    const { t, reportId, read, exists, scheduled, newVideo } = await setup();
    const before = await read();
    await expect(t.mutation(api.retake.retakeReport, { token, reportId, ...(await newVideo()) })).rejects.toThrow(
      "We couldn't find this post.",
    );
    expect(await read()).toEqual(before);
    expect(await exists(before.clipStorageId!)).toBe(true);
    expect(await scheduled()).toHaveLength(0);
  });

  test.each(["reject", "emergency"] as const)("rejects a report held as %s", async (verdict) => {
    const { t, reportId, read, scheduled, newVideo } = await setup({ verdict });
    await expect(t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...(await newVideo()) })).rejects.toThrow(
      "This post can't be retaken.",
    );
    expect((await read()).status).toBe("held");
    expect(await scheduled()).toHaveLength(0);
  });

  test("rejects a held report with no verdict (screening failed)", async () => {
    const { t, reportId, newVideo } = await setup({ verdict: undefined, reason: SCREENING_FAILED_REASON });
    await expect(t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...(await newVideo()) })).rejects.toThrow(
      "This post can't be retaken.",
    );
  });

  test.each(["pending", "open", "fixed"] as const)("rejects a %s report even with a retake verdict", async (status) => {
    const { t, reportId, read, scheduled, newVideo } = await setup({ status });
    await expect(t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...(await newVideo()) })).rejects.toThrow(
      "This post can't be retaken.",
    );
    expect((await read()).status).toBe(status);
    expect(await scheduled()).toHaveLength(0);
  });

  test("refuses a different format: a video post is retaken as a video", async () => {
    const { t, reportId, read, exists, store } = await setup();
    const old = await read();
    await expect(
      t.mutation(api.retake.retakeReport, {
        token: "poster",
        reportId,
        mediaType: "photos",
        frameStorageIds: [await store(image("photo"))],
      }),
    ).rejects.toThrow("Record a new video for this post.");
    expect((await read()).status).toBe("held");
    expect(await exists(old.clipStorageId!)).toBe(true);
  });

  test("new files start a fresh Try again count", async () => {
    const { t, reportId, read, newVideo } = await setup({ screeningRetries: MAX_SCREENING_RETRIES });
    await t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...(await newVideo()) });
    expect((await read()).screeningRetries).toBeUndefined();
  });

  test("refuses to reuse an old file, which it would otherwise delete", async () => {
    const { t, reportId, read, exists, newVideo } = await setup();
    const old = await read();
    const media = await newVideo();
    await expect(
      t.mutation(api.retake.retakeReport, {
        token: "poster",
        reportId,
        ...media,
        frameStorageIds: [old.frameStorageIds[0], ...media.frameStorageIds],
      }),
    ).rejects.toThrow("A retake needs new files.");
    expect(await exists(old.frameStorageIds[0])).toBe(true);
  });

  test("checks the new media like a new post: a video needs its clip, and a frame must be an image", async () => {
    const { t, reportId, read, store, newVideo } = await setup();
    const media = await newVideo();
    await expect(
      t.mutation(api.retake.retakeReport, { token: "poster", reportId, ...media, clipStorageId: undefined }),
    ).rejects.toThrow("A video post needs its clip.");
    await expect(
      t.mutation(api.retake.retakeReport, {
        token: "poster",
        reportId,
        ...media,
        frameStorageIds: [await store(video("not an image"))],
      }),
    ).rejects.toThrow("A photo or frame isn't an image file.");
    expect((await read()).status).toBe("held");
  });
});

describe("retryScreening", () => {
  // What markFailed leaves (§4.2.1): held, no verdict.
  const failedSetup = (fields: Fields = {}) =>
    setup({ verdict: undefined, reason: SCREENING_FAILED_REASON, screeningError: "Claude request failed (500)", ...fields });

  test("puts the owner's failed report back to pending with the same files and reschedules screening", async () => {
    const { t, reportId, read, scheduled } = await failedSetup();
    const before = await read();

    await t.mutation(api.retake.retryScreening, { token: "poster", reportId });

    const report = await read();
    expect(report.status).toBe("pending");
    expect(report.reason).toBeUndefined();
    expect(report.screeningError).toBeUndefined();
    expect(report.screeningRetries).toBe(1);
    expect(report.clipStorageId).toBe(before.clipStorageId);
    expect(report.frameStorageIds).toEqual(before.frameStorageIds);
    const jobs = await scheduled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: "screening:screenReport", args: [{ reportId }] });
  });

  test("the cap is 2 Try agains (§4.2.1)", () => {
    expect(MAX_SCREENING_RETRIES).toBe(2);
  });

  test(`allows ${MAX_SCREENING_RETRIES} Try agains, then refuses`, async () => {
    const { t, reportId, read, scheduled } = await failedSetup({ screeningRetries: MAX_SCREENING_RETRIES - 1 });
    await t.mutation(api.retake.retryScreening, { token: "poster", reportId });
    expect((await read()).screeningRetries).toBe(MAX_SCREENING_RETRIES);

    // Screening fails again.
    await t.run((ctx) => ctx.db.patch(reportId, { status: "held", reason: SCREENING_FAILED_REASON }));
    await expect(t.mutation(api.retake.retryScreening, { token: "poster", reportId })).rejects.toThrow(
      "We've already tried checking this post again.",
    );
    expect((await read()).status).toBe("held");
    expect(await scheduled()).toHaveLength(1);
  });

  test.each([
    ["another resident", "someone-else"],
    ["an unknown token", "nobody"],
  ])("rejects %s", async (_, token) => {
    const { t, reportId, read, scheduled } = await failedSetup();
    await expect(t.mutation(api.retake.retryScreening, { token, reportId })).rejects.toThrow(
      "We couldn't find this post.",
    );
    expect((await read()).status).toBe("held");
    expect(await scheduled()).toHaveLength(0);
  });

  test.each([
    ["held as retake", { verdict: "retake" as const, reason: "A face is visible." }],
    ["held as reject", { verdict: "reject" as const, reason: "Not a public-space problem." }],
    ["held as emergency", { verdict: "emergency" as const, reason: "Downed power line." }],
    ["pending", { status: "pending" as const, reason: SCREENING_FAILED_REASON }],
    ["open", { status: "open" as const, verdict: "pass" as const, reason: "Looks fine." }],
  ])("rejects a report that's %s", async (_, fields) => {
    const { t, reportId, read, scheduled } = await setup(fields);
    const before = await read();
    await expect(t.mutation(api.retake.retryScreening, { token: "poster", reportId })).rejects.toThrow(
      "This post isn't waiting on a failed check.",
    );
    expect(await read()).toEqual(before);
    expect(await scheduled()).toHaveLength(0);
  });
});
