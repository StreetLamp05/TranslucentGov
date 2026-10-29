import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { SCREENING_FAILED_REASON } from "../../server/lib/screening";
import schema from "../../convex/schema";
import { modules } from "./setup";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("a mutation can schedule both pipeline actions with runAfter(0, …), with and without attempt, and they run", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("GOOGLE_GEOCODING_KEY", "");
  const t = convexTest(schema, modules);

  const { reportId, attemptId } = await t.run(async (ctx) => {
    const residentId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    const clip = await ctx.storage.store(new Blob(["clip"]));
    const reportId = await ctx.db.insert("reports", {
      residentId,
      mediaType: "video",
      clipStorageId: clip,
      frameStorageIds: [],
      lat: 33.8187,
      lng: -84.5824,
      status: "pending",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
    const attemptId = await ctx.db.insert("fixAttempts", {
      reportId,
      byKind: "resident",
      byId: residentId,
      clipStorageId: clip,
      frameStorageIds: [],
      lat: 33.8187,
      lng: -84.5824,
      status: "checking",
      createdAt: 2,
    });
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId });
    await ctx.scheduler.runAfter(0, internal.fixVerification.verifyFix, { attemptId });
    // A retry passes the attempt number (§4.2.1).
    await ctx.scheduler.runAfter(0, internal.screening.screenReport, { reportId, attempt: 1 });
    await ctx.scheduler.runAfter(0, internal.fixVerification.verifyFix, { attemptId, attempt: 1 });
    return { reportId, attemptId };
  });

  const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.map((s) => s.name).sort()).toEqual([
    "fixVerification:verifyFix",
    "fixVerification:verifyFix",
    "screening:screenReport",
    "screening:screenReport",
  ]);

  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const done = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  // Plus the retry the first screenReport schedules for itself.
  expect(done.map((s) => s.state.kind)).toEqual(["success", "success", "success", "success", "success"]);
  // screenReport is no longer a stub (US13). This clip has no content type and there are no
  // frames, so both tries fail before any network call and the report is held.
  expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ status: "held", reason: SCREENING_FAILED_REASON });
  // verifyFix is no longer a stub (US22). The report isn't `open`, so the attempt is superseded.
  expect(await t.run((ctx) => ctx.db.get(attemptId))).toMatchObject({ status: "superseded" });
});
