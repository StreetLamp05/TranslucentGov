import { ApiError } from "@google/genai";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/server/db";
import { fixAttempts, fixers, reports, residents, type FixAttempt, type Report } from "@/server/db/schema";
import { FAILED_REASON, RETRY_DELAY_MS, verifyFix } from "@/server/jobs/verifyFix";
import { enqueuedJobs, objects, putTestObject } from "./fakes";

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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  // Not vi.restoreAllMocks(): that would also undo the S3 fake spied on in setup.ts.
  vi.mocked(console.error).mockRestore();
  vi.unstubAllEnvs();
});

async function setup({
  reportStatus = "open",
  attemptStatus = "checking",
  byKind = "fixer",
  mediaType = "video",
}: {
  reportStatus?: Report["status"];
  attemptStatus?: FixAttempt["status"];
  byKind?: FixAttempt["byKind"];
  mediaType?: Report["mediaType"];
} = {}) {
  const [resident] = await db.insert(residents).values({ token: "poster", createdAt: 1 }).returning();
  const [neighbor] = await db.insert(residents).values({ token: "neighbor", createdAt: 1 }).returning();
  const [fixer] = await db.insert(fixers).values({ name: "Dana", org: "Cobb DOT", passcode: "cobb-1" }).returning();
  for (const key of ["before-1", "before-2", "after-1"]) putTestObject(key, key, "image/jpeg");
  putTestObject("fix-clip", "fix clip", "video/webm");
  const [report] = await db
    .insert(reports)
    .values({
      residentId: resident.id,
      mediaType,
      frameStorageIds: ["before-1", "before-2"],
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
    })
    .returning();
  const [attempt] = await db
    .insert(fixAttempts)
    .values({
      reportId: report.id,
      byKind,
      byId: byKind === "fixer" ? fixer.id : neighbor.id,
      clipStorageId: "fix-clip",
      frameStorageIds: ["after-1"],
      lat: 33.8158,
      lng: -84.5825,
      status: attemptStatus,
      createdAt: 2,
    })
    .returning();
  const verify = (attemptNumber?: number) => verifyFix({ fixAttemptId: attempt.id, attempt: attemptNumber });
  const read = async () => ({
    report: (await db.select().from(reports).where(eq(reports.id, report.id)))[0],
    attempt: (await db.select().from(fixAttempts).where(eq(fixAttempts.id, attempt.id)))[0],
  });
  const runRetry = async () => {
    const [job] = enqueuedJobs.splice(0);
    return verifyFix(job.payload as { fixAttemptId: string; attempt?: number });
  };
  return { reportId: report.id, attemptId: attempt.id, fixerId: fixer.id, neighborId: neighbor.id, verify, read, runRetry };
}

describe("verifyFix verdicts", () => {
  test("verified closes the report with the fix fields and names the fixer's org", async () => {
    generateContent.mockResolvedValue(answer("verified", "The pothole is patched."));
    const { verify, read, fixerId } = await setup();
    await verify();

    const { report, attempt } = await read();
    expect(attempt).toMatchObject({ status: "verified", reason: "The pothole is patched." });
    expect(report).toMatchObject({
      status: "fixed",
      fixStorageId: "fix-clip",
      fixedBy: fixerId,
      fixedByKind: "fixer",
      fixedByOrg: "Cobb DOT",
      fixedAt: NOW,
      lastActivityAt: NOW,
    });
  });

  test("a neighbor's verified fix has no org", async () => {
    generateContent.mockResolvedValue(answer("verified", "Repaired."));
    const { verify, read, neighborId } = await setup({ byKind: "resident" });
    await verify();

    const { report } = await read();
    expect(report).toMatchObject({ status: "fixed", fixedBy: neighborId, fixedByKind: "resident", fixedByOrg: null });
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
    expect(report).toMatchObject({ status: "open", lastActivityAt: 1, fixedAt: null, fixStorageId: null });
  });

  test("reads from MinIO: the original's frames go as BEFORE and the fix frames as AFTER, in base64", async () => {
    generateContent.mockResolvedValue(answer("verified", "Fixed."));
    const { verify } = await setup();
    await verify();

    const content = generateContent.mock.calls[0][0].contents[0].parts;
    expect(content.map((b: { text?: string; inlineData?: { data: string } }) => b.text ?? b.inlineData?.data)).toEqual([
      "BEFORE: the original report, 2 frames from its video.",
      btoa("before-1"),
      btoa("before-2"),
      "AFTER: the fix clip, 1 frame.",
      btoa("after-1"),
      expect.stringContaining("<title>Deep pothole in the right lane</title>"),
    ]);
  });

  test("keeps a frame's stored image type", async () => {
    generateContent.mockResolvedValue(answer("verified", "Fixed."));
    const { verify } = await setup();
    putTestObject("after-1", "after-1", "image/webp");
    await verify();
    const parts = generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts.map((b: { inlineData?: { mimeType: string } }) => b.inlineData?.mimeType).filter(Boolean)).toEqual([
      "image/jpeg",
      "image/jpeg",
      "image/webp",
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

  test("an unknown attempt is ignored", async () => {
    await verifyFix({ fixAttemptId: "00000000-0000-4000-8000-000000000000" });
    expect(generateContent).not.toHaveBeenCalled();
    expect(enqueuedJobs).toHaveLength(0);
  });

  test("a report closed by another attempt while Gemini was checking supersedes this one", async () => {
    generateContent.mockImplementation(async () => {
      await db.update(reports).set({ status: "fixed", fixedAt: 5 }).where(eq(reports.id, reportId));
      return answer("verified", "Fixed.");
    });
    const { reportId, verify, read } = await setup();
    await verify();

    const { report, attempt } = await read();
    expect(attempt.status).toBe("superseded");
    expect(report).toMatchObject({ status: "fixed", fixedAt: 5, fixStorageId: null });
  });
});

describe("verifyFix retry", () => {
  test("an error re-enqueues once after the retry delay, and the retry can succeed", async () => {
    generateContent.mockRejectedValueOnce(rateLimited("3s")).mockResolvedValueOnce(answer("verified", "Fixed."));
    const { attemptId, verify, read, runRetry } = await setup();
    await verify();

    expect(enqueuedJobs).toEqual([
      { name: "verifyFix", payload: { fixAttemptId: attemptId, attempt: 1 }, delaySeconds: 3, inTransaction: false },
    ]);
    expect((await read()).attempt.status).toBe("checking");

    await runRetry();
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect((await read()).attempt.status).toBe("verified");
  });

  test("an error without a retry delay waits the default delay", async () => {
    generateContent.mockRejectedValueOnce(new Error("socket hang up"));
    const { verify } = await setup();
    await verify();
    expect(enqueuedJobs[0].delaySeconds).toBe(RETRY_DELAY_MS / 1000);
  });

  test("a second error marks the attempt failed with a reason for the person filming", async () => {
    generateContent.mockRejectedValue(rateLimited("1s"));
    const { verify, read, runRetry } = await setup();
    await verify();
    await runRetry();

    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(enqueuedJobs).toHaveLength(0);
    const { report, attempt } = await read();
    expect(attempt).toMatchObject({ status: "failed", reason: FAILED_REASON });
    expect(report.status).toBe("open");
  });

  test("a report closed by another attempt before the final failure supersedes this one", async () => {
    generateContent.mockImplementation(async () => {
      await db.update(reports).set({ status: "fixed" }).where(eq(reports.id, reportId));
      throw new Error("down");
    });
    const { reportId, verify, read } = await setup();
    await verify(1);

    const { attempt } = await read();
    expect(attempt.status).toBe("superseded");
    expect(attempt.reason).toBeNull();
  });

  test("unusable output counts as an error", async () => {
    generateContent.mockResolvedValue(answer("maybe", "Unsure."));
    const { verify, read, runRetry } = await setup();
    await verify();
    await runRetry();
    expect((await read()).attempt.status).toBe("failed");
  });

  test("a missing image file counts as an error", async () => {
    const { verify, read, runRetry } = await setup();
    objects.delete("after-1");
    await verify();
    await runRetry();

    expect(generateContent).not.toHaveBeenCalled();
    expect((await read()).attempt.status).toBe("failed");
  });
});
