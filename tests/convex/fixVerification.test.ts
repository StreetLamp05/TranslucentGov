import { ApiError } from "@google/genai";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { FAILED_REASON, RETRY_DELAY_MS } from "../../convex/fixVerification";
import schema from "../../convex/schema";
import { modules } from "./setup";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class FakeGoogleGenAI {
    models = { generateContent };
  }
  return { ...actual, GoogleGenAI: FakeGoogleGenAI };
});

const NOW = Date.UTC(2026, 9, 25, 12);

function answer(verdict: string, reason: string) {
  return { candidates: [{ finishReason: "STOP" }], text: JSON.stringify({ verdict, reason }) };
}

function rateLimited(retryDelay: string) {
  const details = [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }];
  return new ApiError({ message: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", details } }), status: 429 });
}

beforeEach(() => {
  generateContent.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const image = (bytes: string) => new Blob([bytes], { type: "image/jpeg" });

async function setup({
  reportStatus = "open",
  attemptStatus = "checking",
  byKind = "fixer",
  mediaType = "video",
}: {
  reportStatus?: Doc<"reports">["status"];
  attemptStatus?: Doc<"fixAttempts">["status"];
  byKind?: Doc<"fixAttempts">["byKind"];
  mediaType?: Doc<"reports">["mediaType"];
} = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const neighborId = await ctx.db.insert("residents", { token: "neighbor", createdAt: 1 });
    const fixerId = await ctx.db.insert("fixers", { name: "Dana", org: "Cobb DOT", passcode: "cobb-1" });
    const before = [await ctx.storage.store(image("before-1")), await ctx.storage.store(image("before-2"))];
    const reportId = await ctx.db.insert("reports", {
      residentId,
      mediaType,
      frameStorageIds: before,
      lat: 33.8158,
      lng: -84.5825,
      category: "pothole",
      owner: "cobb",
      agency: "Cobb DOT",
      title: "Deep pothole in the right lane",
      status: reportStatus,
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
    const clipStorageId = await ctx.storage.store(new Blob(["fix clip"], { type: "video/webm" }));
    const after = [await ctx.storage.store(image("after-1"))];
    const attemptId = await ctx.db.insert("fixAttempts", {
      reportId,
      byKind,
      byId: byKind === "fixer" ? fixerId : neighborId,
      clipStorageId,
      frameStorageIds: after,
      lat: 33.8158,
      lng: -84.5825,
      status: attemptStatus,
      createdAt: 2,
    });
    return { reportId, attemptId, fixerId, neighborId, clipStorageId };
  });
  const verify = (attempt?: number) => t.action(internal.fixVerification.verifyFix, { attemptId: ids.attemptId, attempt });
  const read = () =>
    t.run(async (ctx) => ({ report: (await ctx.db.get(ids.reportId))!, attempt: (await ctx.db.get(ids.attemptId))! }));
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return { t, ...ids, verify, read, scheduled };
}

const toBase64 = (s: string) => btoa(s);

describe("verifyFix verdicts", () => {
  test("verified closes the report with the fix fields and names the fixer's org", async () => {
    generateContent.mockResolvedValue(answer("verified", "The pothole is patched."));
    const { verify, read, fixerId, clipStorageId } = await setup();
    await verify();

    const { report, attempt } = await read();
    expect(attempt).toMatchObject({ status: "verified", reason: "The pothole is patched." });
    expect(report).toMatchObject({
      status: "fixed",
      fixStorageId: clipStorageId,
      fixedBy: fixerId,
      fixedByKind: "fixer",
      fixedByOrg: "Cobb DOT",
    });
    // convex-test may nudge the fake clock forward a millisecond per write.
    expect(report.fixedAt).toBeGreaterThanOrEqual(NOW);
    expect(report.lastActivityAt).toBe(report.fixedAt);
  });

  test("a neighbor's verified fix has no org", async () => {
    generateContent.mockResolvedValue(answer("verified", "Repaired."));
    const { verify, read, neighborId } = await setup({ byKind: "resident" });
    await verify();

    const { report } = await read();
    expect(report).toMatchObject({ status: "fixed", fixedBy: neighborId, fixedByKind: "resident" });
    expect(report.fixedByOrg).toBeUndefined();
  });

  test.each([
    ["not_fixed", "The pothole is still there."],
    ["retake", "A worker's face is visible. Film again without people in frame."],
  ])("%s stores the reason on the attempt and leaves the report open", async (verdict, reason) => {
    generateContent.mockResolvedValue(answer(verdict, reason));
    const { verify, read } = await setup();
    await verify();

    const { report, attempt } = await read();
    expect(attempt).toMatchObject({ status: verdict, reason });
    expect(report).toMatchObject({ status: "open", lastActivityAt: 1 });
    expect(report.fixedAt).toBeUndefined();
    expect(report.fixStorageId).toBeUndefined();
  });

  test("sends the original's frames as BEFORE and the fix frames as AFTER, in base64", async () => {
    generateContent.mockResolvedValue(answer("verified", "Fixed."));
    const { verify } = await setup();
    await verify();

    const content = generateContent.mock.calls[0][0].contents[0].parts;
    expect(content.map((b: { text?: string; inlineData?: { data: string } }) => b.text ?? b.inlineData?.data)).toEqual([
      "BEFORE: the original report, 2 frames from its video.",
      toBase64("before-1"),
      toBase64("before-2"),
      "AFTER: the fix clip, 1 frame.",
      toBase64("after-1"),
      expect.stringContaining("<title>Deep pothole in the right lane</title>"),
    ]);
  });

  test("labels a slideshow's originals as photos", async () => {
    generateContent.mockResolvedValue(answer("verified", "Fixed."));
    const { verify } = await setup({ mediaType: "photos" });
    await verify();
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].text).toBe("BEFORE: the original report, 2 photos.");
  });
});

describe("verifyFix guards", () => {
  test.each(["fixed", "held", "pending"] as const)("a report that's %s supersedes the attempt without calling Gemini", async (status) => {
    const { verify, read } = await setup({ reportStatus: status });
    await verify();

    expect(generateContent).not.toHaveBeenCalled();
    const { report, attempt } = await read();
    expect(attempt.status).toBe("superseded");
    expect(report.status).toBe(status);
  });

  test("an attempt that isn't checking is left alone", async () => {
    const { verify, read } = await setup({ attemptStatus: "not_fixed" });
    await verify();

    expect(generateContent).not.toHaveBeenCalled();
    expect((await read()).attempt.status).toBe("not_fixed");
  });

  test("a report closed by another attempt while Gemini was checking supersedes this one", async () => {
    const { t, attemptId, reportId, read } = await setup();
    await t.run((ctx) => ctx.db.patch(reportId, { status: "fixed", fixedAt: 5 }));
    await t.mutation(internal.fixVerificationDb.applyFixVerdict, { attemptId, verdict: "verified", reason: "Fixed." });

    const { report, attempt } = await read();
    expect(attempt.status).toBe("superseded");
    expect(report).toMatchObject({ status: "fixed", fixedAt: 5 });
    expect(report.fixStorageId).toBeUndefined();
  });
});

describe("verifyFix retry", () => {
  test("an error retries once after the retry delay, and the retry can succeed", async () => {
    generateContent.mockRejectedValueOnce(rateLimited("3s")).mockResolvedValueOnce(answer("verified", "Fixed."));
    const { t, verify, read, scheduled, attemptId } = await setup();
    await verify();

    const [retry] = await scheduled();
    expect(retry).toMatchObject({ name: "fixVerification:verifyFix", args: [{ attemptId, attempt: 1 }] });
    expect(retry.scheduledTime).toBe(NOW + 3000);
    expect((await read()).attempt.status).toBe("checking");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((await read()).attempt.status).toBe("verified");
  });

  test("an error without a retry delay waits the default delay", async () => {
    generateContent.mockRejectedValueOnce(new Error("socket hang up"));
    const { verify, scheduled } = await setup();
    await verify();
    expect((await scheduled())[0].scheduledTime).toBe(NOW + RETRY_DELAY_MS);
  });

  test("a second error marks the attempt failed with a reason for the person filming", async () => {
    generateContent.mockRejectedValue(rateLimited("1s"));
    const { t, verify, read, scheduled } = await setup();
    await verify();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((await scheduled()).map((s) => s.state.kind)).toEqual(["success"]);
    const { report, attempt } = await read();
    expect(attempt).toMatchObject({ status: "failed", reason: FAILED_REASON });
    expect(report.status).toBe("open");
  });

  test("a report closed by another attempt before the final failure supersedes this one", async () => {
    const { t, attemptId, reportId, read } = await setup();
    await t.run((ctx) => ctx.db.patch(reportId, { status: "fixed" }));
    await t.mutation(internal.fixVerificationDb.markFailed, { attemptId, reason: FAILED_REASON });

    const { attempt } = await read();
    expect(attempt.status).toBe("superseded");
    expect(attempt.reason).toBeUndefined();
  });

  test("unusable output counts as an error", async () => {
    generateContent.mockResolvedValue(answer("maybe", "Unsure."));
    const { t, verify, read } = await setup();
    await verify();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await read()).attempt.status).toBe("failed");
  });

  test("a missing image file counts as an error", async () => {
    const { t, verify, read, attemptId } = await setup();
    await t.run(async (ctx) => {
      const attempt = (await ctx.db.get(attemptId))!;
      await ctx.storage.delete(attempt.frameStorageIds[0]);
    });
    await verify();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(generateContent).not.toHaveBeenCalled();
    expect((await read()).attempt.status).toBe("failed");
  });
});
