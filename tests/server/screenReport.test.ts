import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { reports, residents, type Report } from "@/server/db/schema";
import { screenReport, RETRY_DELAY_MS } from "@/server/jobs/screenReport";
import { GeminiError } from "@/server/lib/gemini";
import { ROUTING, type Category } from "@/server/lib/routing";
import { MAX_SCREENING_ERROR_LENGTH, SCREENING_FAILED_REASON } from "@/server/lib/screening";
import type { ScreenResult } from "@/server/lib/screenPrompt";
import { enqueuedJobs, putTestObject } from "./fakes";

const { screenPost, transcribe } = vi.hoisted(() => ({ screenPost: vi.fn(), transcribe: vi.fn() }));

vi.mock("@/server/lib/screenPrompt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/lib/screenPrompt")>()),
  screenPost,
}));
vi.mock("@/server/lib/transcribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/lib/transcribe")>()),
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
  // Only the clock: PGlite needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // Not vi.restoreAllMocks(): that would also undo the S3 fake spied on in setup.ts.
  vi.mocked(console.error).mockRestore();
  vi.mocked(console.warn).mockRestore();
});

async function setup({
  mediaType = "video",
  status = "pending",
  description,
  isSample = false,
}: {
  mediaType?: Report["mediaType"];
  status?: Report["status"];
  description?: string;
  isSample?: boolean;
} = {}) {
  const [resident] = await db.insert(residents).values({ token: "poster", createdAt: 1 }).returning();
  putTestObject("frame-1", "frame-1", "image/jpeg");
  putTestObject("frame-2", "frame-2", "image/jpeg");
  if (mediaType === "video") putTestObject("clip-1", "clip bytes", "video/webm");
  const [report] = await db
    .insert(reports)
    .values({
      residentId: resident.id,
      mediaType,
      description,
      clipStorageId: mediaType === "video" ? "clip-1" : null,
      frameStorageIds: ["frame-1", "frame-2"],
      ...AT,
      status,
      audioMuted: false,
      isSample,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    })
    .returning();
  const reportId = report.id;
  const screen = (attempt?: number) => screenReport({ reportId, attempt });
  const read = async () => (await db.select().from(reports).where(eq(reports.id, reportId)))[0];
  // The retry job the handler queued, if any, run by hand as the worker would.
  const runRetry = async () => {
    const [job] = enqueuedJobs.splice(0);
    return screenReport(job.payload as { reportId: string; attempt?: number });
  };
  return { reportId, residentId: resident.id, screen, read, runRetry };
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
    if (status === "open") expect(report.lastActivityAt).toBe(NOW);
    else expect(report.lastActivityAt).toBe(1);
  });

  test.each(Object.keys(ROUTING) as Category[])("%s takes its owner and agency from the routing table", async (category) => {
    screenPost.mockResolvedValue(result("pass", category));
    const { screen, read } = await setup();
    await screen();
    expect(await read()).toMatchObject({ category, ...ROUTING[category] });
  });

  test("reads the media from MinIO and sends frames as base64, plus transcript, description and street", async () => {
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

  test("keeps a frame's stored image type", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen } = await setup();
    putTestObject("frame-2", "frame-2", "image/png");
    await screen();
    expect(screenPost.mock.calls[0][0].images.map((i: { mediaType: string }) => i.mediaType)).toEqual(["image/jpeg", "image/png"]);
  });

  test("a photo post skips transcription and sends the photos", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup({ mediaType: "photos" });
    await screen();

    expect(transcribe).not.toHaveBeenCalled();
    expect(screenPost.mock.calls[0][0]).toMatchObject({ transcript: undefined, images: [{}, {}] });
    const report = await read();
    expect(report.status).toBe("open");
    expect(report.transcript).toBeNull();
    expect(report.segments).toBeNull();
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
    const { screen, read } = await setup();
    await screen();

    expect(screenPost.mock.calls[0][0].street).toBeUndefined();
    const report = await read();
    expect(report.status).toBe("open");
    expect(report.street).toBeNull();
    expect(enqueuedJobs).toHaveLength(0);
  });

  test("without a key, it doesn't call Google", async () => {
    vi.stubEnv("GOOGLE_GEOCODING_KEY", "");
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup();
    await screen();

    expect(geocode).not.toHaveBeenCalled();
    expect((await read()).status).toBe("open");
  });

  test("a rescreen reuses the stored street instead of geocoding again (§1.1.2)", async () => {
    screenPost.mockResolvedValue(result("reject"));
    const { reportId, screen, read } = await setup();
    await screen();
    expect(geocode).toHaveBeenCalledTimes(1);

    await db.update(reports).set({ status: "pending" }).where(eq(reports.id, reportId));
    await screen();
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(screenPost.mock.calls[1][0].street).toBe("Floyd Rd");
    expect(await read()).toMatchObject({ street: "Floyd Rd" });
  });
});

describe("screenReport guards", () => {
  test.each(["held", "open", "fixed"] as const)("a report that's %s isn't screened", async (status) => {
    const { screen, read } = await setup({ status });
    await screen();

    expect(screenPost).not.toHaveBeenCalled();
    expect((await read()).status).toBe(status);
  });

  test("an unknown report is ignored", async () => {
    await screenReport({ reportId: "00000000-0000-4000-8000-000000000000" });
    expect(screenPost).not.toHaveBeenCalled();
    expect(enqueuedJobs).toHaveLength(0);
  });

  test("a result for media a retake replaced is dropped", async () => {
    const { reportId, screen, read } = await setup();
    // The retake lands while Gemini is still checking the old clip.
    screenPost.mockImplementation(async () => {
      await db.update(reports).set({ frameStorageIds: ["retake-frame"] }).where(eq(reports.id, reportId));
      return result("pass");
    });
    await screen();

    const report = await read();
    expect(report).toMatchObject({ status: "pending", frameStorageIds: ["retake-frame"], verdict: null, title: null });
  });

  test("a result for a report that left pending meanwhile is dropped", async () => {
    const { reportId, screen, read } = await setup();
    screenPost.mockImplementation(async () => {
      await db.update(reports).set({ status: "held", reason: "held by hand" }).where(eq(reports.id, reportId));
      return result("pass");
    });
    await screen();
    expect(await read()).toMatchObject({ status: "held", reason: "held by hand" });
  });

  test("a final failure for media a retake replaced is dropped too", async () => {
    const { reportId, screen, read } = await setup();
    screenPost.mockImplementation(async () => {
      await db.update(reports).set({ clipStorageId: "retake-clip" }).where(eq(reports.id, reportId));
      throw new Error("down");
    });
    await screen(1);
    expect((await read()).status).toBe("pending");
  });

  test("a sample keeps its backdated lastActivityAt when it goes public (US25)", async () => {
    screenPost.mockResolvedValue(result("pass"));
    const { screen, read } = await setup({ isSample: true });
    await screen();
    expect(await read()).toMatchObject({ status: "open", lastActivityAt: 1 });
  });

  test("a photo retake of a narrated video drops the old transcript", async () => {
    screenPost.mockResolvedValue(result("retake"));
    const { reportId, screen, read } = await setup();
    await screen();
    expect((await read()).transcript).toBe(SEGMENTS[0].text);

    // The shape of a retake: same report, new media, back to pending.
    putTestObject("retake-photo", "retake-photo", "image/jpeg");
    await db
      .update(reports)
      .set({ mediaType: "photos", clipStorageId: null, frameStorageIds: ["retake-photo"], status: "pending" })
      .where(eq(reports.id, reportId));
    screenPost.mockResolvedValue(result("pass"));
    await screen();

    expect(await read()).toMatchObject({ status: "open", verdict: "pass", transcript: null, segments: null });
  });

  test("a later pass clears audioMuted from an earlier mute", async () => {
    screenPost.mockResolvedValueOnce(result("mute")).mockResolvedValueOnce(result("pass"));
    const { reportId, screen, read } = await setup();
    await screen();
    expect((await read()).audioMuted).toBe(true);
    await db.update(reports).set({ status: "pending" }).where(eq(reports.id, reportId));
    await screen();
    expect(await read()).toMatchObject({ verdict: "pass", audioMuted: false });
  });
});

describe("screenReport retry", () => {
  test("a Gemini 429 re-enqueues once with its retry delay, and the retry can succeed", async () => {
    screenPost
      .mockRejectedValueOnce(new GeminiError("rate_limited", "Gemini rate limited", 3000))
      .mockResolvedValueOnce(result("pass"));
    const { reportId, screen, read, runRetry } = await setup();
    await screen();

    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId, attempt: 1 }, delaySeconds: 3, inTransaction: false },
    ]);
    expect((await read()).status).toBe("pending");

    await runRetry();
    expect(screenPost).toHaveBeenCalledTimes(2);
    expect((await read()).status).toBe("open");
  });

  test("a fractional retry delay rounds up to whole seconds", async () => {
    screenPost.mockRejectedValueOnce(new GeminiError("rate_limited", "Gemini rate limited", 500));
    const { screen } = await setup();
    await screen();
    expect(enqueuedJobs[0].delaySeconds).toBe(1);
  });

  test("a transcription 429 waits for Gemini's retry delay", async () => {
    transcribe.mockRejectedValueOnce(new GeminiError("rate_limited", "Gemini rate limited", 7000));
    const { screen } = await setup();
    await screen();
    expect(enqueuedJobs[0].delaySeconds).toBe(7);
  });

  test("an error without retry-after waits the default delay", async () => {
    screenPost.mockRejectedValueOnce(new Error("socket hang up"));
    const { screen } = await setup();
    await screen();
    expect(enqueuedJobs[0].delaySeconds).toBe(RETRY_DELAY_MS / 1000);
  });

  test("a second failure holds the report with reason \"screening failed\"", async () => {
    screenPost.mockRejectedValue(new GeminiError("api", "Gemini request failed (500)"));
    const { screen, read, runRetry } = await setup();
    await screen();
    await runRetry();

    expect(screenPost).toHaveBeenCalledTimes(2);
    expect(enqueuedJobs).toHaveLength(0);
    const report = await read();
    // The error is kept for the poster's debug line (US14).
    expect(report).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: "Gemini request failed (500)",
      verdict: null,
    });
  });

  test("a refusal retries once like any other error, then holds the report", async () => {
    screenPost.mockRejectedValue(new GeminiError("refusal", "Gemini blocked the response (reason: SAFETY)"));
    const { screen, read, runRetry } = await setup();
    await screen();
    expect(enqueuedJobs).toHaveLength(1);
    await runRetry();

    expect(screenPost).toHaveBeenCalledTimes(2);
    expect(enqueuedJobs).toHaveLength(0);
    expect(await read()).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: "Gemini blocked the response (reason: SAFETY)",
    });
  });

  test("keeps only the first 500 characters of a long error", async () => {
    screenPost.mockRejectedValue(new Error("x".repeat(2000)));
    const { screen, read, runRetry } = await setup();
    await screen();
    await runRetry();
    expect(MAX_SCREENING_ERROR_LENGTH).toBe(500);
    expect((await read()).screeningError).toBe("x".repeat(500));
  });

  test("a transcription failure on both tries holds the report without screening", async () => {
    transcribe.mockRejectedValue(new GeminiError("api", "Gemini request failed (500)"));
    const { screen, read, runRetry } = await setup();
    await screen();
    await runRetry();

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(screenPost).not.toHaveBeenCalled();
    expect(await read()).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      screeningError: "Gemini request failed (500)",
    });
  });

  test("a missing frame file counts as an error", async () => {
    const { screen, read, runRetry } = await setup();
    (await import("./fakes")).objects.delete("frame-1");
    await screen();
    await runRetry();

    expect(screenPost).not.toHaveBeenCalled();
    expect((await read()).status).toBe("held");
  });

  test("a failed rescreen clears the earlier result, so release can't publish it", async () => {
    screenPost.mockResolvedValueOnce(result("mute")).mockRejectedValue(new GeminiError("refusal", "blocked"));
    const { reportId, screen, read } = await setup();
    await screen();
    await db.update(reports).set({ status: "pending" }).where(eq(reports.id, reportId));
    await screen(1);

    expect(await read()).toMatchObject({
      status: "held",
      reason: SCREENING_FAILED_REASON,
      audioMuted: false,
      verdict: null,
      category: null,
      owner: null,
      agency: null,
      title: null,
    });
  });
});
