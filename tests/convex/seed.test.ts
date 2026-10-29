import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MAX_POLLS, POLL_MS, SCREEN_STAGGER_MS } from "../../convex/seed";
import schema from "../../convex/schema";
import { modules } from "./setup";

const NOW = Date.UTC(2026, 9, 25, 12);
const DAY = 24 * 60 * 60 * 1000;
const PASSCODE = "seed-admin-passcode";
const AT = { lat: 33.8254, lng: -84.5769 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ADMIN_PASSCODE", PASSCODE);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type T = ReturnType<typeof convexTest>;

async function uploads(t: T) {
  return await t.run(async (ctx) => ({
    clip: await ctx.storage.store(new Blob(["clip"], { type: "video/webm" })),
    frames: [
      await ctx.storage.store(new Blob(["f1"], { type: "image/jpeg" })),
      await ctx.storage.store(new Blob(["f2"], { type: "image/jpeg" })),
    ],
  }));
}

async function videoSample(t: T, extra: Record<string, unknown> = {}) {
  const { clip, frames } = await uploads(t);
  return { mediaType: "video" as const, clipStorageId: clip, frameStorageIds: frames, ...AT, ...extra };
}

async function scheduled(t: T) {
  return await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
}

describe("passcode", () => {
  for (const passcode of ["wrong", "", PASSCODE.slice(0, -1)]) {
    test(`every seed function rejects ${JSON.stringify(passcode)}`, async () => {
      const t = convexTest(schema, modules);
      const sample = await videoSample(t);
      await expect(t.mutation(api.seed.generateUploadUrl, { passcode })).rejects.toThrow("Wrong admin passcode");
      await expect(t.query(api.seed.fixers, { passcode })).rejects.toThrow("Wrong admin passcode");
      await expect(t.query(api.seed.samples, { passcode })).rejects.toThrow("Wrong admin passcode");
      await expect(t.mutation(api.seed.seedSamples, { passcode, samples: [sample] })).rejects.toThrow("Wrong admin passcode");
      expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(0);
      expect(await scheduled(t)).toHaveLength(0);
    });
  }

  test("rejects everything when ADMIN_PASSCODE isn't set", async () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.seed.generateUploadUrl, { passcode: "" })).rejects.toThrow("Wrong admin passcode");
  });

  test("the right passcode works", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.seed.generateUploadUrl, { passcode: PASSCODE })).resolves.toEqual(expect.any(String));
    await expect(t.query(api.seed.samples, { passcode: PASSCODE })).resolves.toEqual([]);
  });
});

describe("seedSamples", () => {
  test("inserts samples with isSample, the requested resident and backdated timestamps", async () => {
    const t = convexTest(schema, modules);
    const mine = await videoSample(t, {
      description: "  Deep one  ",
      createdAt: NOW - 23 * DAY,
      lastActivityAt: NOW - 2 * DAY,
      residentToken: "demo-phone",
    });
    const theirs = await videoSample(t, { createdAt: NOW - 5 * DAY });
    const [mineId, theirsId] = await t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [mine, theirs] });

    const { reports, phone } = await t.run(async (ctx) => ({
      reports: await Promise.all([ctx.db.get(mineId), ctx.db.get(theirsId)]),
      phone: await ctx.db.query("residents").withIndex("by_token", (q) => q.eq("token", "demo-phone")).unique(),
    }));
    expect(reports[0]).toMatchObject({
      isSample: true,
      status: "pending",
      residentId: phone!._id,
      description: "Deep one",
      createdAt: NOW - 23 * DAY,
      lastActivityAt: NOW - 2 * DAY,
      meTooCount: 0,
      revealViews: 0,
      audioMuted: false,
    });
    // No token: a fresh resident of its own, and lastActivityAt defaults to createdAt.
    expect(reports[1]).toMatchObject({ isSample: true, createdAt: NOW - 5 * DAY, lastActivityAt: NOW - 5 * DAY });
    expect(reports[1]!.residentId).not.toBe(phone!._id);
  });

  test("defaults to now when nothing is backdated", async () => {
    const t = convexTest(schema, modules);
    const [id] = await t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [await videoSample(t)] });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ createdAt: NOW, lastActivityAt: NOW });
  });

  test("schedules the real screenReport, staggered 10 s apart", async () => {
    const t = convexTest(schema, modules);
    const samples = [await videoSample(t), await videoSample(t), await videoSample(t)];
    const ids = await t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples });
    const jobs = await scheduled(t);
    expect(SCREEN_STAGGER_MS).toBe(10_000);
    // convex-test's clock moves a millisecond per call, so times are relative to the first job.
    const first = jobs[0].scheduledTime;
    expect(first - NOW).toBeLessThan(100);
    expect(jobs.map((j) => ({ name: j.name, args: j.args[0], after: j.scheduledTime - first }))).toEqual(
      ids.map((reportId, i) => ({ name: "screening:screenReport", args: { reportId }, after: i * 10_000 })),
    );
  });

  test("photo samples need photos and no clip", async () => {
    const t = convexTest(schema, modules);
    const { clip, frames } = await uploads(t);
    const photos = { mediaType: "photos" as const, frameStorageIds: frames, ...AT };
    const [id] = await t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [photos] });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ mediaType: "photos", isSample: true });
    await expect(
      t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [{ ...photos, clipStorageId: clip }] }),
    ).rejects.toThrow("can't have a clip");
  });

  test.each([
    ["a future createdAt", { createdAt: NOW + DAY }, "in the future"],
    ["activity before posting", { createdAt: NOW - 3 * DAY, lastActivityAt: NOW - 4 * DAY }, "before it was posted"],
    ["a bad location", { lat: 200 }, "location"],
  ])("refuses %s, and seeds nothing from the batch", async (_, extra, message) => {
    const t = convexTest(schema, modules);
    const good = await videoSample(t);
    const bad = await videoSample(t, extra);
    await expect(t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [good, bad] })).rejects.toThrow(
      `Sample 2: `,
    );
    await expect(t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [bad] })).rejects.toThrow(message);
    expect(await t.run((ctx) => ctx.db.query("reports").collect())).toHaveLength(0);
  });

  test("refuses a clip we can't transcribe (an iPhone .MOV), which would be held for good", async () => {
    const t = convexTest(schema, modules);
    const mov = await t.run((ctx) => ctx.storage.store(new Blob(["mov"], { type: "video/quicktime" })));
    const sample = await videoSample(t, { clipStorageId: mov });
    await expect(t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [sample] })).rejects.toThrow("MP4 or WebM");
    const mp4 = await t.run((ctx) => ctx.storage.store(new Blob(["mp4"], { type: "video/mp4" })));
    await expect(
      t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [await videoSample(t, { clipStorageId: mp4 })] }),
    ).resolves.toHaveLength(1);
  });

  test("refuses a fix dated before the report", async () => {
    const t = convexTest(schema, modules);
    const { clip, frames } = await uploads(t);
    const sample = await videoSample(t, {
      createdAt: NOW - 3 * DAY,
      fix: { clipStorageId: clip, frameStorageIds: frames, by: { kind: "resident" }, fixedAt: NOW - 4 * DAY },
    });
    await expect(t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [sample] })).rejects.toThrow(
      "fixed before it was posted",
    );
  });
});

describe("seed fix clips", () => {
  async function seedWithFix(t: T, by: { kind: "resident" } | { kind: "fixer"; fixerId: Id<"fixers"> }, fixedAt?: number) {
    const fixUploads = await uploads(t);
    const sample = await videoSample(t, {
      createdAt: NOW - 20 * DAY,
      lastActivityAt: NOW - 20 * DAY,
      fix: { clipStorageId: fixUploads.clip, frameStorageIds: fixUploads.frames, by, fixedAt },
    });
    const [reportId] = await t.mutation(api.seed.seedSamples, { passcode: PASSCODE, samples: [sample] });
    return { reportId, fixClip: fixUploads.clip };
  }

  const open = (t: T, reportId: Id<"reports">, owner: "cobb" | "city" = "cobb") =>
    t.run((ctx) => ctx.db.patch(reportId, { status: "open", category: "pothole", owner, agency: "Cobb DOT", title: "Pothole" }));

  async function addFixer(t: T) {
    return await t.run((ctx) => ctx.db.insert("fixers", { name: "Dana", org: "Cobb DOT", passcode: "cobb-1" }));
  }

  test("waits for screening, then files the attempt and schedules the real verifyFix", async () => {
    const t = convexTest(schema, modules);
    const fixerId = await addFixer(t);
    const { reportId, fixClip } = await seedWithFix(t, { kind: "fixer", fixerId });
    const attach = (await scheduled(t)).find((j) => j.name === "seed:attachFix")!;
    const screen = (await scheduled(t)).find((j) => j.name === "screening:screenReport")!;
    expect(attach.scheduledTime - screen.scheduledTime).toBe(POLL_MS);

    // Still pending: polls again, files nothing.
    await t.mutation(internal.seed.attachFix, attach.args[0]);
    expect(await t.run((ctx) => ctx.db.query("fixAttempts").collect())).toHaveLength(0);
    expect((await scheduled(t)).filter((j) => j.name === "seed:attachFix")).toHaveLength(2);

    await open(t, reportId);
    await t.mutation(internal.seed.attachFix, attach.args[0]);
    const [attempt] = await t.run((ctx) => ctx.db.query("fixAttempts").collect());
    expect(attempt).toMatchObject({ reportId, byKind: "fixer", byId: fixerId, clipStorageId: fixClip, status: "checking", ...AT });
    const verify = (await scheduled(t)).filter((j) => j.name === "fixVerification:verifyFix");
    expect(verify.map((j) => j.args[0])).toEqual([{ attemptId: attempt._id }]);
  });

  test("drops the fix when the report was held", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedWithFix(t, { kind: "fixer", fixerId: await addFixer(t) });
    await t.run((ctx) => ctx.db.patch(reportId, { status: "held" }));
    const attach = (await scheduled(t)).find((j) => j.name === "seed:attachFix")!;
    await t.mutation(internal.seed.attachFix, attach.args[0]);
    expect(await t.run((ctx) => ctx.db.query("fixAttempts").collect())).toHaveLength(0);
  });

  test("stops polling after MAX_POLLS", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedWithFix(t, { kind: "resident" });
    const attach = (await scheduled(t)).find((j) => j.name === "seed:attachFix")!;
    await t.mutation(internal.seed.attachFix, { ...attach.args[0], polls: MAX_POLLS - 1 });
    expect((await scheduled(t)).filter((j) => j.name === "seed:attachFix")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ status: "pending" });
  });

  test("a neighbor fix follows §4.3.2: refused on a city-owned report, filed otherwise", async () => {
    const t = convexTest(schema, modules);
    const city = await seedWithFix(t, { kind: "resident" });
    const cobb = await seedWithFix(t, { kind: "resident" });
    await open(t, city.reportId, "city");
    await open(t, cobb.reportId, "cobb");
    for (const job of (await scheduled(t)).filter((j) => j.name === "seed:attachFix")) {
      await t.mutation(internal.seed.attachFix, job.args[0]);
    }
    const attempts = await t.run((ctx) => ctx.db.query("fixAttempts").collect());
    expect(attempts.map((a) => [a.reportId, a.byKind])).toEqual([[cobb.reportId, "resident"]]);
  });

  test("backdates fixedAt once the real check verifies the fix", async () => {
    const t = convexTest(schema, modules);
    const fixedAt = NOW - 3 * DAY;
    const { reportId } = await seedWithFix(t, { kind: "fixer", fixerId: await addFixer(t) }, fixedAt);
    await open(t, reportId);
    await t.mutation(internal.seed.attachFix, (await scheduled(t)).find((j) => j.name === "seed:attachFix")!.args[0]);
    const backdate = (await scheduled(t)).find((j) => j.name === "seed:backdateFix")!;
    const { attemptId } = backdate.args[0] as { attemptId: Id<"fixAttempts"> };

    // Still checking: polls again, changes nothing.
    await t.mutation(internal.seed.backdateFix, backdate.args[0]);
    expect((await scheduled(t)).filter((j) => j.name === "seed:backdateFix")).toHaveLength(2);

    // What the real verifyFix's mutation does on `verified`.
    await t.mutation(internal.fixVerificationDb.applyFixVerdict, { attemptId, verdict: "verified", reason: "Patched." });
    const stamped = await t.run((ctx) => ctx.db.get(reportId));
    expect(stamped).toMatchObject({ status: "fixed" });
    expect(stamped!.fixedAt).toBeGreaterThanOrEqual(NOW);

    await t.mutation(internal.seed.backdateFix, backdate.args[0]);
    expect(await t.run((ctx) => ctx.db.get(reportId))).toMatchObject({ status: "fixed", fixedAt, lastActivityAt: fixedAt });
  });

  test("leaves fixedAt alone when the check didn't verify", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedWithFix(t, { kind: "fixer", fixerId: await addFixer(t) }, NOW - DAY);
    await open(t, reportId);
    await t.mutation(internal.seed.attachFix, (await scheduled(t)).find((j) => j.name === "seed:attachFix")!.args[0]);
    const backdate = (await scheduled(t)).find((j) => j.name === "seed:backdateFix")!;
    const { attemptId } = backdate.args[0] as { attemptId: Id<"fixAttempts"> };
    await t.mutation(internal.fixVerificationDb.applyFixVerdict, { attemptId, verdict: "not_fixed", reason: "Still there." });
    await t.mutation(internal.seed.backdateFix, backdate.args[0]);
    const report = await t.run((ctx) => ctx.db.get(reportId));
    expect(report).toMatchObject({ status: "open", lastActivityAt: NOW - 20 * DAY });
    expect(report!.fixedAt).toBeUndefined();
  });

  test("samples lists sample reports with their fix progress, not resident posts", async () => {
    const t = convexTest(schema, modules);
    const { reportId } = await seedWithFix(t, { kind: "resident" });
    await t.run(async (ctx) => {
      const residentId = await ctx.db.insert("residents", { token: "r", createdAt: NOW });
      const frame = await ctx.storage.store(new Blob(["x"], { type: "image/jpeg" }));
      await ctx.db.insert("reports", {
        residentId,
        mediaType: "photos",
        frameStorageIds: [frame],
        ...AT,
        status: "open",
        audioMuted: false,
        isSample: false,
        meTooCount: 0,
        lastActivityAt: NOW,
        revealViews: 0,
        createdAt: NOW,
      });
    });
    const rows = await t.query(api.seed.samples, { passcode: PASSCODE });
    expect(rows.map((r) => [r._id, r.status, r.fix])).toEqual([[reportId, "pending", null]]);
  });
});
