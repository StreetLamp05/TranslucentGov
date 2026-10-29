import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { CITY_ONLY, tooFarMessage } from "../../server/lib/fixRules";
import type { Owner } from "../../server/lib/routing";
import schema from "../../convex/schema";
import { modules } from "./setup";

// Fake timers keep the scheduled verifyFix from running (it would call Claude); its own
// behavior is tested in fixVerification.test.ts.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const REPORT = { lat: 33.8158, lng: -84.5825 };
// ~111 m per 0.001° of latitude.
const metersNorth = (m: number) => ({ lat: REPORT.lat + m / 111_000, lng: REPORT.lng });

async function setup({ owner = "cobb", status = "open" }: { owner?: Owner; status?: Doc<"reports">["status"] } = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const posterId = await ctx.db.insert("residents", { token: "poster", createdAt: 1 });
    await ctx.db.insert("residents", { token: "neighbor", createdAt: 1 });
    await ctx.db.insert("residents", { token: "other-neighbor", createdAt: 1 });
    await ctx.db.insert("fixers", { name: "Dana", org: "Mableton Sanitation", passcode: "4821", token: "fixer-token" });
    await ctx.db.insert("fixers", { name: "Lee", org: "Cobb DOT", passcode: "5555", token: "other-fixer" });
    const frame = await ctx.storage.store(new Blob(["before"], { type: "image/jpeg" }));
    const reportId = await ctx.db.insert("reports", {
      residentId: posterId,
      mediaType: "video",
      frameStorageIds: [frame],
      ...REPORT,
      category: owner === "city" ? "trash_missed" : "pothole",
      owner,
      agency: owner === "city" ? "Mableton Sanitation" : "Cobb DOT",
      title: "A problem",
      status,
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
    });
    const clipStorageId = await ctx.storage.store(new Blob(["fix clip"], { type: "video/webm" }));
    const frameStorageIds = [
      await ctx.storage.store(new Blob(["after-1"], { type: "image/jpeg" })),
      await ctx.storage.store(new Blob(["after-2"], { type: "image/jpeg" })),
    ];
    return { reportId, clipStorageId, frameStorageIds };
  });
  const submit = (auth: { fixerToken?: string; residentToken?: string }, at = metersNorth(10)) =>
    t.mutation(api.fixes.submitFix, { reportId: ids.reportId, clipStorageId: ids.clipStorageId, frameStorageIds: ids.frameStorageIds, ...at, ...auth });
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const attempts = () => t.run((ctx) => ctx.db.query("fixAttempts").collect());
  return { t, ...ids, submit, scheduled, attempts };
}

describe("submitFix", () => {
  test("rejects a clip filmed more than 50 m from the report", async () => {
    const { submit, attempts, scheduled } = await setup();
    await expect(submit({ fixerToken: "fixer-token" }, metersNorth(60))).rejects.toThrow(/Get within 50 m \(you're 6\d m away\)/);
    expect(await attempts()).toHaveLength(0);
    expect(await scheduled()).toHaveLength(0);
  });

  test("accepts a clip just inside 50 m", async () => {
    const { submit } = await setup();
    await expect(submit({ fixerToken: "fixer-token" }, metersNorth(49))).resolves.toBeTruthy();
  });

  test.each(["fixed", "pending", "held"] as const)("rejects a report that's %s", async (status) => {
    const { submit, attempts } = await setup({ status });
    await expect(submit({ fixerToken: "fixer-token" })).rejects.toThrow(/isn't open/);
    expect(await attempts()).toHaveLength(0);
  });

  test("rejects a bad or empty fixer token, and a call with no token", async () => {
    const { submit, attempts } = await setup();
    await expect(submit({ fixerToken: "forged" })).rejects.toThrow(/Invalid fixer token/);
    await expect(submit({ fixerToken: "" })).rejects.toThrow(/Missing fixer token/);
    await expect(submit({})).rejects.toThrow(/Missing token/);
    expect(await attempts()).toHaveLength(0);
  });

  test("rejects a resident on a city-owned report (§4.3.2)", async () => {
    const { submit, attempts } = await setup({ owner: "city" });
    await expect(submit({ residentToken: "neighbor" })).rejects.toThrow(CITY_ONLY);
    expect(await attempts()).toHaveLength(0);
  });

  test.each(["cobb", "utility", "unknown"] as const)("accepts a resident on a %s report", async (owner) => {
    const { t, submit, attempts } = await setup({ owner });
    const attemptId = await submit({ residentToken: "neighbor" });
    const neighbor = await t.run((ctx) =>
      ctx.db.query("residents").withIndex("by_token", (q) => q.eq("token", "neighbor")).unique(),
    );
    const [attempt] = await attempts();
    expect(attempt._id).toBe(attemptId);
    expect(attempt).toMatchObject({ byKind: "resident", byId: neighbor!._id, status: "checking" });
  });

  test("a brand-new device can confirm (its resident row is created)", async () => {
    const { submit, attempts } = await setup();
    await submit({ residentToken: "new-device" });
    expect(await attempts()).toHaveLength(1);
  });

  test.each(["city", "cobb", "utility", "unknown"] as const)("accepts a fixer on a %s report", async (owner) => {
    const { submit, attempts, clipStorageId, frameStorageIds, reportId } = await setup({ owner });
    await submit({ fixerToken: "fixer-token" }, metersNorth(10));
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({
      reportId,
      byKind: "fixer",
      clipStorageId,
      frameStorageIds,
      status: "checking",
      lat: metersNorth(10).lat,
      lng: REPORT.lng,
    });
    expect(attempt.reason).toBeUndefined();
  });

  test("schedules verifyFix for the new attempt", async () => {
    const { submit, scheduled } = await setup();
    const attemptId = await submit({ fixerToken: "fixer-token" });
    const jobs = await scheduled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe("fixVerification:verifyFix");
    expect(jobs[0].args).toEqual([{ attemptId }]);
  });

  test("rejects files of the wrong kind and a bad frame count", async () => {
    const { t, reportId, clipStorageId, frameStorageIds } = await setup();
    const base = { reportId, clipStorageId, frameStorageIds, ...metersNorth(10), fixerToken: "fixer-token" };
    await expect(t.mutation(api.fixes.submitFix, { ...base, clipStorageId: frameStorageIds[0] })).rejects.toThrow(/isn't a video/);
    await expect(t.mutation(api.fixes.submitFix, { ...base, frameStorageIds: [clipStorageId] })).rejects.toThrow(/isn't an image/);
    await expect(t.mutation(api.fixes.submitFix, { ...base, frameStorageIds: [] })).rejects.toThrow(/1 to 6 frames/);
  });
});

describe("tooFarMessage", () => {
  test("rounds up, so a distance just past 50 m never reads as 50 m", () => {
    expect(tooFarMessage(50.3, 50)).toBe("Get within 50 m (you're 51 m away)");
    expect(tooFarMessage(120, 50)).toBe("Get within 50 m (you're 120 m away)");
  });
});

describe("myFixAttempt", () => {
  async function submitted(byKind: "fixer" | "resident") {
    const s = await setup();
    const attemptId = (await s.submit(byKind === "fixer" ? { fixerToken: "fixer-token" } : { residentToken: "neighbor" })) as Id<"fixAttempts">;
    const read = (auth: { fixerToken?: string; residentToken?: string }) => s.t.query(api.fixes.myFixAttempt, { attemptId, ...auth });
    return { ...s, attemptId, read };
  }

  test("returns a fixer's attempt to that fixer, and null to anyone else", async () => {
    const { read, reportId } = await submitted("fixer");
    expect(await read({ fixerToken: "fixer-token" })).toEqual({ reportId, status: "checking", reason: undefined });
    expect(await read({ fixerToken: "other-fixer" })).toBeNull();
    expect(await read({ fixerToken: "forged" })).toBeNull();
    expect(await read({ residentToken: "neighbor" })).toBeNull();
    expect(await read({})).toBeNull();
  });

  test("returns a neighbor's attempt to that neighbor, and null to anyone else", async () => {
    const { read, reportId } = await submitted("resident");
    expect(await read({ residentToken: "neighbor" })).toEqual({ reportId, status: "checking", reason: undefined });
    expect(await read({ residentToken: "other-neighbor" })).toBeNull();
    expect(await read({ residentToken: "poster" })).toBeNull();
    expect(await read({ residentToken: "unknown-device" })).toBeNull();
    expect(await read({ fixerToken: "fixer-token" })).toBeNull();
    expect(await read({})).toBeNull();
  });

  test("carries Claude's reason back once the check settles", async () => {
    const { t, read, attemptId } = await submitted("fixer");
    await t.run((ctx) => ctx.db.patch(attemptId, { status: "not_fixed", reason: "The pothole is still there." }));
    expect(await read({ fixerToken: "fixer-token" })).toMatchObject({ status: "not_fixed", reason: "The pothole is still there." });
  });
});
