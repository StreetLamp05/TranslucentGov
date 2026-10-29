import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { GeminiError } from "../../convex/lib/gemini";
import { ROUTING, type Category } from "../../convex/lib/routing";
import { MAX_SCREENING_ERROR_LENGTH, SCREENING_FAILED_REASON } from "../../convex/lib/screening";
import type { ScreenResult } from "../../convex/lib/screenPrompt";
import { RETRY_DELAY_MS } from "../../convex/screening";
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

const NOW = Date.UTC(2026, 9, 25, 12);
const AT = { lat: 33.8158, lng: -84.5825 };
const SEGMENTS = [{ start: 0, end: 2.5, text: "This pothole has been here since June." }];

// Google's reverse-geocoding shape, trimmed to what screenReport reads.
function geocodeAnswer(route = "Floyd Rd") {
  return Response.json({
    status: "OK",
    results: [
      {
        address_components: [
          { short_name: "412", types: ["street_number"] },
          { short_name: route, long_name: "Floyd Road", types: ["route"] },
          { short_name: "Mableton", types: ["locality", "political"] },
        ],
      },
    ],
  });
}
const geocode = vi.fn<typeof fetch>();

function result(verdict: ScreenResult["verdict"], category: Category = "pothole"): ScreenResult {
  return { verdict, reason: `Reason for ${verdict}.`, category, title: "Deep pothole in the right lane" };
}

beforeEach(() => {
  screenPost.mockReset();
  transcribe.mockReset().mockResolvedValue({ text: SEGMENTS[0].text, segments: SEGMENTS });
  geocode.mockReset().mockImplementation(async () => geocodeAnswer());
  vi.stubGlobal("fetch", geocode);
  vi.stubEnv("GOOGLE_GEOCODING_KEY", "test-geocoding-key");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const image = (bytes: string) => new Blob([bytes], { type: "image/jpeg" });

async function setup({
  mediaType = "video",
  status = "pending",
  description,
  isSample = false,
}: {
  mediaType?: Doc<"reports">["mediaType"];
  status?: Doc<"reports">["status"];
  description?: string;
  isSample?: boolean;
} = {}) {
  const t = convexTest(schema, modules);
  const reportId = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const frames = [await ctx.storage.store(image("frame-1")), await ctx.storage.store(image("frame-2"))];
    const clipStorageId =
      mediaType === "video" ? await ctx.storage.store(new Blob(["clip bytes"], { type: "video/webm" })) : undefined;
    return await ctx.db.insert("reports", {
      residentId,
      mediaType,
      description,
      clipStorageId,
      frameStorageIds: frames,
      ...AT,
      status,
      audioMuted: false,
      isSample,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
  });
  const screen = (attempt?: number) => t.action(internal.screening.screenReport, { reportId, attempt });
  const read = () => t.run(async (ctx) => (await ctx.db.get(reportId))!);
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const runScheduled = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, reportId, screen, read, scheduled, runScheduled };
}

describe("screenReport verdicts", () => {
  test.each([
    ["pass", "open", false],
    ["mute", "open", true],
    ["retake", "held", false],
    ["reject", "held", false],
    ["emergency", "held", false],
  ] as const)("%s → %s (audioMuted %s)", async (verdict, status, audioMuted) => {
    screenPost.mockResolvedValue(result(verdict));
    const { screen, read } = await setup();
    await screen();

    const report = await read();
    expect(report).toMatchObject({
      status,
      verdict,
      audioMuted,
      reason: `Reason for ${verdict}.`,
      category: "pothole",
      title: "Deep pothole in the right lane",
      street: "Floyd Rd",
      transcript: SEGMENTS[0].text,
      segments: SEGMENTS,
    });
    // Going public bumps the report to the top of the feed (§5.1.2); a held one stays put.
    if (status === "open") expect(report.lastActivityAt).toBeGreaterThanOrEqual(NOW);
    else expect(report.lastActivityAt).toBe(1);
  });

  test.each(Object.keys(ROUTING) as Category[])("%s takes its owner and agency from the routing table", async (category) => {
    screenPost.mockResolvedValue(result("pass", category));
    const { screen, read } = await setup();
    await screen();
    expect(await read()).toMatchObject({ category, ...ROUTING[category] });
  });

  test("sends the frames as base64, the transcript, description and street to screenPost", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen } = await setup({ description: "Right by the bus stop" });
    await screen();

    expect(transcribe).toHaveBeenCalledTimes(1);
    const [clip, contentType] = transcribe.mock.calls[0];
    expect(await (clip as Blob).text()).toBe("clip bytes");
    expect(contentType).toBe("video/webm");
    expect(screenPost).toHaveBeenCalledWith({
      images: [
        { mediaType: "image/jpeg", data: btoa("frame-1") },
        { mediaType: "image/jpeg", data: btoa("frame-2") },
      ],
      transcript: SEGMENTS[0].text,
      description: "Right by the bus stop",
      street: "Floyd Rd",
    });
    const url = new URL(String(geocode.mock.calls[0][0]));
    expect(url.searchParams.get("latlng")).toBe(`${AT.lat},${AT.lng}`);
    expect(url.searchParams.get("key")).toBe("test-geocoding-key");
  });

  test("a photo post skips transcription and sends the photos", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup({ mediaType: "photos" });
    await screen();

    expect(transcribe).not.toHaveBeenCalled();
    expect(screenPost.mock.calls[0][0]).toMatchObject({ transcript: undefined, images: [{}, {}] });
    const report = await read();
    expect(report.status).toBe("open");
    expect(report.transcript).toBeUndefined();
    expect(report.segments).toBeUndefined();
  });
});

describe("screenReport geocoding", () => {
  test.each([
    ["the request throws", () => Promise.reject(new Error("network down"))],
    ["Google answers 500", async () => new Response("oops", { status: 500 })],
    ["there are no results", async () => Response.json({ status: "ZERO_RESULTS", results: [] })],
    ["the key is refused", async () => Response.json({ status: "REQUEST_DENIED", results: [] })],
  ])("when %s, screening continues without a street", async (_, answer) => {
    geocode.mockImplementation(answer);
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read, scheduled } = await setup();
    await screen();

    expect(screenPost.mock.calls[0][0].street).toBeUndefined();
    const report = await read();
    expect(report.status).toBe("open");
    expect(report.street).toBeUndefined();
    expect(await scheduled()).toHaveLength(0);
  });

  test("without a key, it doesn't call Google", async () => {
    vi.stubEnv("GOOGLE_GEOCODING_KEY", "");
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup();
    await screen();

    expect(geocode).not.toHaveBeenCalled();
    expect((await read()).status).toBe("open");
  });
});

describe("screenReport guards", () => {
  test.each(["held", "open", "fixed"] as const)("a report that's %s isn't screened", async (status) => {
    const { screen, read } = await setup({ status });
    await screen();

    expect(screenPost).not.toHaveBeenCalled();
    expect((await read()).status).toBe(status);
  });

  test("a result for media a retake replaced is dropped", async () => {
    const { t, reportId, screen, read } = await setup();
    const newFrame = await t.run((ctx) => ctx.storage.store(image("retake-frame")));
    // The retake lands while Claude is still checking the old clip.
    screenPost.mockImplementation(async () => {
      await t.run((ctx) => ctx.db.patch(reportId, { frameStorageIds: [newFrame] }));
      return result("pass");
    });
    await screen();

    const report = await read();
    expect(report).toMatchObject({ status: "pending", frameStorageIds: [newFrame] });
    expect(report.verdict).toBeUndefined();
    expect(report.title).toBeUndefined();
  });

  test("a result for a report that left pending meanwhile is dropped", async () => {
    const { t, reportId, screen, read } = await setup();
    screenPost.mockImplementation(async () => {
      await t.run((ctx) => ctx.db.patch(reportId, { status: "held", reason: "held by hand" }));
      return result("pass");
    });
    await screen();
    expect(await read()).toMatchObject({ status: "held", reason: "held by hand" });
  });

  test("a final failure for media a retake replaced is dropped too", async () => {
    const { t, reportId, read } = await setup();
    const media = await t.run(async (ctx) => {
      const report = (await ctx.db.get(reportId))!;
      return { clipStorageId: report.clipStorageId, frameStorageIds: report.frameStorageIds };
    });
    const newClip = await t.run((ctx) => ctx.storage.store(new Blob(["retake"], { type: "video/webm" })));
    await t.run((ctx) => ctx.db.patch(reportId, { clipStorageId: newClip }));
    await t.mutation(internal.screeningDb.markFailed, { reportId, media });
    expect((await read()).status).toBe("pending");
  });
});

describe("screenReport retry", () => {
  test("a Gemini 429 retries once after its retry delay, and the retry can succeed", async () => {
    screenPost
      .mockRejectedValueOnce(new GeminiError("rate_limited", "Gemini rate limited", 3000))
      .mockResolvedValueOnce(result("pass"));
    const { reportId, screen, read, scheduled, runScheduled } = await setup();
    await screen();

    const [retry] = await scheduled();
    expect(retry).toMatchObject({ name: "screening:screenReport", args: [{ reportId, attempt: 1 }] });
    expect(retry.scheduledTime).toBe(NOW + 3000);
    expect((await read()).status).toBe("pending");

    await runScheduled();
    expect(screenPost).toHaveBeenCalledTimes(2);
    expect((await read()).status).toBe("open");
  });

  test("a Groq 429 waits for the retry-after in its error", async () => {
    transcribe.mockRejectedValueOnce(new Error("Groq transcription failed (429). Retry after 7 seconds. slow down"));
    const { screen, scheduled } = await setup();
    await screen();
    expect((await scheduled())[0].scheduledTime).toBe(NOW + 7000);
  });

  test("an error without retry-after waits the default delay", async () => {
    screenPost.mockRejectedValueOnce(new Error("socket hang up"));
    const { screen, scheduled } = await setup();
    await screen();
    expect((await scheduled())[0].scheduledTime).toBe(NOW + RETRY_DELAY_MS);
  });

  test("a second failure holds the report with reason \"screening failed\"", async () => {
    screenPost.mockRejectedValue(new GeminiError("api", "Gemini request failed (500)"));
    const { screen, read, scheduled, runScheduled } = await setup();
    await screen();
    await runScheduled();

    expect(screenPost).toHaveBeenCalledTimes(2);
    expect((await scheduled()).map((s) => s.state.kind)).toEqual(["success"]);
    const report = await read();
    // The error is kept for the poster's debug line (US14).
    expect(report).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: "Gemini request failed (500)",
    });
    expect(report.verdict).toBeUndefined();
  });

  test("keeps only the first 500 characters of a long error", async () => {
    screenPost.mockRejectedValue(new Error("x".repeat(2000)));
    const { screen, read, runScheduled } = await setup();
    await screen();
    await runScheduled();
    expect(MAX_SCREENING_ERROR_LENGTH).toBe(500);
    expect((await read()).screeningError).toBe("x".repeat(500));
  });

  test("a transcription failure on both tries holds the report without calling Claude", async () => {
    transcribe.mockRejectedValue(new Error("Groq transcription failed (500)."));
    const { screen, read, runScheduled } = await setup();
    await screen();
    await runScheduled();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(screenPost).not.toHaveBeenCalled();
    expect(await read()).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: "Groq transcription failed (500).",
    });
  });

  test("a missing frame file counts as an error", async () => {
    const { t, reportId, screen, read, runScheduled } = await setup();
    await t.run(async (ctx) => ctx.storage.delete((await ctx.db.get(reportId))!.frameStorageIds[0]));
    await screen();
    await runScheduled();

    expect(screenPost).not.toHaveBeenCalled();
    expect((await read()).status).toBe("held");
  });
});

describe("rescreen and release", () => {
  test("rescreen sends a held report back to pending and screens it again", async () => {
    screenPost.mockResolvedValueOnce(result("retake")).mockResolvedValueOnce(result("pass"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    expect((await read()).status).toBe("held");

    await t.mutation(internal.screeningDb.rescreen, { reportId });
    const pending = await read();
    expect(pending.status).toBe("pending");
    expect(pending.verdict).toBeUndefined();
    expect(pending.reason).toBeUndefined();

    await runScheduled();
    expect(await read()).toMatchObject({ status: "open", verdict: "pass" });
  });

  test("rescreen clears a failed screening's error, so the debug line can't show a stale one", async () => {
    const { t, reportId, read } = await setup({ status: "held" });
    await t.run((ctx) =>
      ctx.db.patch(reportId, { reason: SCREENING_FAILED_REASON, screeningError: "Claude request failed (500)" }),
    );
    await t.mutation(internal.screeningDb.rescreen, { reportId });
    expect((await read()).screeningError).toBeUndefined();
  });

  test.each(["open", "fixed"] as const)("rescreen refuses a %s report", async (status) => {
    const { t, reportId, read, scheduled } = await setup({ status });
    await expect(t.mutation(internal.screeningDb.rescreen, { reportId })).rejects.toThrow(/Only a held or pending report/);
    expect((await read()).status).toBe(status);
    expect(await scheduled()).toHaveLength(0);
  });

  test("rescreen unsticks a pending report whose screening died", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { t, reportId, read, runScheduled } = await setup();
    // No screenReport ran (or it died without scheduling its retry).
    await t.mutation(internal.screeningDb.rescreen, { reportId });
    await runScheduled();
    expect(await read()).toMatchObject({ status: "open", verdict: "pass" });
  });

  test("a later pass clears audioMuted from an earlier mute", async () => {
    screenPost.mockResolvedValueOnce(result("mute")).mockResolvedValueOnce(result("pass"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    expect((await read()).audioMuted).toBe(true);
    await t.run((ctx) => ctx.db.patch(reportId, { status: "held" }));

    await t.mutation(internal.screeningDb.rescreen, { reportId });
    await runScheduled();
    expect(await read()).toMatchObject({ status: "open", verdict: "pass", audioMuted: false });
  });

  test("a photo retake of a narrated video drops the old transcript", async () => {
    screenPost.mockResolvedValueOnce(result("retake")).mockResolvedValueOnce(result("pass"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    expect((await read()).transcript).toBe(SEGMENTS[0].text);

    // The shape of a US14 retake: same report, new media, back to pending.
    const photo = await t.run((ctx) => ctx.storage.store(image("retake-photo")));
    await t.run((ctx) =>
      ctx.db.patch(reportId, { mediaType: "photos", clipStorageId: undefined, frameStorageIds: [photo], status: "held" }),
    );
    await t.mutation(internal.screeningDb.rescreen, { reportId });
    await runScheduled();

    const report = await read();
    expect(report).toMatchObject({ status: "open", verdict: "pass" });
    expect(report.transcript).toBeUndefined();
    expect(report.segments).toBeUndefined();
  });

  test("a rescreen reuses the stored street instead of geocoding again (§1.1.2)", async () => {
    screenPost.mockResolvedValueOnce(result("reject")).mockResolvedValueOnce(result("pass"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    expect(geocode).toHaveBeenCalledTimes(1);

    await t.mutation(internal.screeningDb.rescreen, { reportId });
    await runScheduled();
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(screenPost.mock.calls[1][0].street).toBe("Floyd Rd");
    expect(await read()).toMatchObject({ status: "open", street: "Floyd Rd" });
  });

  test("a retry after a failed geocode tries Google again", async () => {
    geocode.mockRejectedValueOnce(new Error("network down"));
    screenPost.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(result("pass"));
    const { screen, read, runScheduled } = await setup();
    await screen();
    await runScheduled();
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(await read()).toMatchObject({ status: "open", street: "Floyd Rd" });
  });

  test("a sample keeps its backdated lastActivityAt when it goes public (US25)", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup({ isSample: true });
    await screen();
    expect(await read()).toMatchObject({ status: "open", lastActivityAt: 1 });
  });

  test("a failed rescreen clears the earlier result, so release can't publish it", async () => {
    screenPost.mockResolvedValueOnce(result("mute")).mockRejectedValue(new Error("down"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    await t.run((ctx) => ctx.db.patch(reportId, { status: "held" }));

    await t.mutation(internal.screeningDb.rescreen, { reportId });
    await runScheduled();
    const report = await read();
    expect(report).toMatchObject({ status: "held", reason: SCREENING_FAILED_REASON, audioMuted: false });
    for (const field of ["verdict", "category", "owner", "agency", "title"] as const) expect(report[field]).toBeUndefined();
    await expect(t.mutation(internal.screeningDb.release, { reportId })).rejects.toThrow(/category or title/);
  });

  test.each(["retake", "reject", "emergency"] as const)("release refuses a %s report without force", async (verdict) => {
    screenPost.mockResolvedValue(result(verdict));
    const { t, reportId, screen, read } = await setup();
    await screen();
    await expect(t.mutation(internal.screeningDb.release, { reportId })).rejects.toThrow(
      new RegExp(`held as ${verdict} \\("Reason for ${verdict}\\."\\).*"force": true`),
    );
    expect((await read()).status).toBe("held");
  });

  test("release with force opens a held report and bumps it in the feed", async () => {
    screenPost.mockResolvedValue(result("reject"));
    const { t, reportId, screen, read } = await setup();
    await screen();
    await t.mutation(internal.screeningDb.release, { reportId, force: true });

    const report = await read();
    expect(report).toMatchObject({ status: "open", category: "pothole", ...ROUTING.pothole });
    expect(report.lastActivityAt).toBeGreaterThanOrEqual(NOW);
  });

  test("releasing a sample keeps its backdated lastActivityAt", async () => {
    screenPost.mockResolvedValue(result("retake"));
    const { t, reportId, screen, read } = await setup({ isSample: true });
    await screen();
    await t.mutation(internal.screeningDb.release, { reportId, force: true });
    expect(await read()).toMatchObject({ status: "open", lastActivityAt: 1 });
  });

  test("release refuses a held report with no category or title", async () => {
    screenPost.mockRejectedValue(new Error("down"));
    const { t, reportId, screen, read, runScheduled } = await setup();
    await screen();
    await runScheduled();
    expect((await read()).reason).toBe(SCREENING_FAILED_REASON);

    await expect(t.mutation(internal.screeningDb.release, { reportId })).rejects.toThrow(/category or title/);
    expect((await read()).status).toBe("held");
  });

  test.each(["pending", "open"] as const)("release refuses a %s report", async (status) => {
    const { t, reportId } = await setup({ status });
    await expect(t.mutation(internal.screeningDb.release, { reportId })).rejects.toThrow(/Only a held report/);
  });
});

test("a post through createReport ends up screened", async () => {
  screenPost.mockResolvedValue(result("pass"));
  const t = convexTest(schema, modules);
  const store = (blob: Blob) => t.run((ctx) => ctx.storage.store(blob));
  const reportId: Id<"reports"> = await t.mutation(api.posts.createReport, {
    token: "resident-a",
    mediaType: "video",
    clipStorageId: await store(new Blob(["clip"], { type: "video/mp4" })),
    frameStorageIds: [await store(image("frame"))],
    ...AT,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(transcribe.mock.calls[0][1]).toBe("video/mp4");
  expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ status: "open", street: "Floyd Rd" });
});
