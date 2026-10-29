import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as fixersGet, POST as fixersPost } from "@/app/api/admin/fixers/route";
import { GET as samplesGet, POST as samplesPost } from "@/app/api/admin/samples/route";
import { db } from "@/server/db";
import { fixAttempts, fixers, reports, residents } from "@/server/db/schema";
import {
  attachSeedFix,
  ATTACH_SEED_FIX,
  backdateSeedFix,
  BACKDATE_SEED_FIX,
  MAX_POLLS,
  POLL_SECONDS,
  type AttachSeedFixPayload,
  type BackdateSeedFixPayload,
} from "@/server/jobs/seedFix";
import { FILE_IN_USE } from "@/server/posts";
import { SCREEN_STAGGER_SECONDS } from "@/server/seed";
import { adminApi, adminUpload, loginAdmin } from "./admin";
import { insertReport, reportRow, upload } from "./api";
import { enqueuedJobs } from "./fakes";

// /admin/seed (§6.1.1), ported from tests/convex/seed.test.ts: the samples, their fix clips, the
// fixers and the table of progress.

const NOW = Date.UTC(2026, 9, 25, 12);
const DAY = 24 * 60 * 60 * 1000;
const AT = { lat: 33.8254, lng: -84.5769 };

beforeEach(() => {
  // Only the clock: PGlite needs real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(console.warn).mockRestore();
});

let token: string;
beforeEach(async () => {
  token = await loginAdmin();
});

const adminFrames = (n = 2) => Promise.all(Array.from({ length: n }, (_, i) => adminUpload(token, "image/jpeg", `frame ${i}`)));
async function videoSample(extra: Record<string, unknown> = {}, type = "video/webm") {
  return { mediaType: "video", clipStorageId: await adminUpload(token, type, crypto.randomUUID()), frameStorageIds: await adminFrames(), ...AT, ...extra };
}
const seed = (samples: unknown, as: string | null = token) => adminApi(as, samplesPost, { body: { samples } });
const jobs = (name: string) => enqueuedJobs.filter((job) => job.name === name);

describe("who may seed", () => {
  it("every admin seed route rejects a caller without a session", async () => {
    const sample = await videoSample();
    for (const as of [null, "wrong"]) {
      expect((await seed([sample], as)).status).toBe(401);
      expect((await adminApi(as, samplesGet, { method: "GET" })).status).toBe(401);
      expect((await adminApi(as, fixersGet, { method: "GET" })).status).toBe(401);
      expect((await adminApi(as, fixersPost, { body: { fixers: [{ name: "A", org: "B", passcode: "c" }] } })).status).toBe(401);
    }
    expect(await db.select().from(reports)).toHaveLength(0);
    expect(await db.select().from(fixers)).toHaveLength(0);
    expect(enqueuedJobs).toHaveLength(0);
  });
});

describe("seedSamples", () => {
  it("saves samples with isSample, the requested resident and backdated timestamps", async () => {
    const mine = await videoSample({ description: "  Deep one  ", createdAt: NOW - 23 * DAY, lastActivityAt: NOW - 2 * DAY, residentToken: "demo-phone" });
    const theirs = await videoSample({ createdAt: NOW - 5 * DAY });

    const { status, body } = await seed([mine, theirs]);
    const [mineId, theirsId] = body as string[];

    expect(status).toBe(200);
    const [phone] = await db.select().from(residents).where(eq(residents.token, "demo-phone"));
    expect(await reportRow(mineId)).toMatchObject({
      isSample: true,
      status: "pending",
      residentId: phone.id,
      mediaType: "video",
      description: "Deep one",
      clipStorageId: mine.clipStorageId,
      frameStorageIds: mine.frameStorageIds,
      createdAt: NOW - 23 * DAY,
      lastActivityAt: NOW - 2 * DAY,
      meTooCount: 0,
      revealViews: 0,
      audioMuted: false,
      ...AT,
    });
    // No token: a fresh resident of its own, and lastActivityAt defaults to createdAt.
    const other = await reportRow(theirsId);
    expect(other).toMatchObject({ isSample: true, createdAt: NOW - 5 * DAY, lastActivityAt: NOW - 5 * DAY });
    expect(other.residentId).not.toBe(phone.id);
  });

  it("defaults to now when nothing is backdated", async () => {
    const [id] = (await seed([await videoSample()])).body as string[];
    expect(await reportRow(id)).toMatchObject({ createdAt: NOW, lastActivityAt: NOW });
  });

  it("queues the real screenReport in the transaction, staggered 10 s apart", async () => {
    const { body } = await seed([await videoSample(), await videoSample(), await videoSample()]);
    expect(SCREEN_STAGGER_SECONDS).toBe(10);
    expect(
      jobs("screenReport").map(({ payload, delaySeconds, inTransaction }) => ({ payload, delaySeconds, inTransaction })),
    ).toEqual((body as string[]).map((reportId, i) => ({ payload: { reportId }, delaySeconds: i * 10, inTransaction: true })));
  });

  it("saves photo samples, which have photos and no clip", async () => {
    const photos = { mediaType: "photos", frameStorageIds: await adminFrames(3), ...AT };
    const [id] = (await seed([photos])).body as string[];
    expect(await reportRow(id)).toMatchObject({ mediaType: "photos", isSample: true, clipStorageId: null });

    const withClip = { ...photos, frameStorageIds: await adminFrames(), clipStorageId: await adminUpload(token, "video/mp4") };
    const refused = await seed([withClip]);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("can't have a clip");
  });

  it.each([
    ["a future createdAt", { createdAt: NOW + DAY }, "in the future"],
    ["activity before posting", { createdAt: NOW - 3 * DAY, lastActivityAt: NOW - 4 * DAY }, "before it was posted"],
    ["a fractional date", { createdAt: NOW - 1.5 }, "date isn't valid"],
    ["an absurd date", { createdAt: -1e30 }, "date isn't valid"],
    ["a bad location", { lat: 200 }, "location"],
    ["a long description", { description: "x".repeat(281) }, "at most 280"],
  ])("refuses %s, and seeds nothing from the batch", async (_, extra, message) => {
    const good = await videoSample();
    const bad = await videoSample(extra);

    const { status, body } = await seed([good, bad]);

    expect(status).toBe(400);
    expect((body as { error: string }).error).toMatch(/^Sample 2: /);
    expect((body as { error: string }).error).toContain(message);
    expect(await db.select().from(reports)).toHaveLength(0);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("refuses a clip we can't transcribe (an iPhone .MOV), which would be held for good", async () => {
    const mov = await videoSample({}, "video/quicktime");
    const refused = await seed([mov]);
    expect(refused.status).toBe(400);
    expect((refused.body as { error: string }).error).toContain("MP4 or WebM");
    expect(await seed([await videoSample({}, "video/mp4")])).toMatchObject({ status: 200 });
  });

  it("refuses files the admin didn't upload, missing files and the wrong kind of file", async () => {
    const sample = await videoSample();
    const residentClip = await upload("resident", "video/mp4", "theirs");
    expect((await seed([{ ...sample, clipStorageId: residentClip }])).status).toBe(400);
    expect((await seed([{ ...sample, clipStorageId: crypto.randomUUID() }])).status).toBe(400);
    const image = await adminUpload(token, "image/jpeg");
    expect((await seed([{ ...sample, clipStorageId: image }])).status).toBe(400);
    expect((await seed([{ ...sample, frameStorageIds: [await adminUpload(token, "video/mp4")] }])).status).toBe(400);
    expect((await seed([{ ...sample, frameStorageIds: [] }])).status).toBe(400);
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("refuses a malformed body instead of failing with a server error", async () => {
    expect((await adminApi(token, samplesPost, { body: {} })).status).toBe(400);
    for (const sample of [null, 5, {}, { mediaType: "video" }, { ...(await videoSample()), lat: "33" }, { ...(await videoSample()), frameStorageIds: [1] }]) {
      expect((await seed([sample])).status).toBe(400);
    }
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("refuses a file used by two samples in one batch, or by an existing post", async () => {
    const one = await videoSample();
    expect((await seed([one, { ...(await videoSample()), clipStorageId: one.clipStorageId }])).status).toBe(400);

    const posted = await insertReport("poster", { frameStorageIds: [one.frameStorageIds[0] as string] });
    expect(await seed([one])).toEqual({ status: 400, body: { error: FILE_IN_USE } });
    expect(await db.select().from(reports)).toHaveLength(1);
    expect(posted.isSample).toBe(false);
  });

  it("is safe to run again: the same batch returns the same reports and queues nothing twice", async () => {
    const fixer = await fixerRow();
    const withFix = await videoSample({ fix: { clipStorageId: await adminUpload(token, "video/mp4"), frameStorageIds: await adminFrames(), by: { kind: "fixer", fixerId: fixer.id } } });
    const batch = [await videoSample(), withFix];

    const first = (await seed(batch)).body as string[];
    const queued = enqueuedJobs.length;
    const again = (await seed(batch)).body as string[];

    expect(again).toEqual(first);
    expect(await db.select().from(reports)).toHaveLength(2);
    expect(enqueuedJobs).toHaveLength(queued);

    // A new sample in a re-sent batch is still added, and screened from the start of the stagger.
    const fresh = await videoSample();
    const third = (await seed([...batch, fresh])).body as string[];
    expect(third.slice(0, 2)).toEqual(first);
    expect(await db.select().from(reports)).toHaveLength(3);
    expect(enqueuedJobs.at(-1)).toMatchObject({ name: "screenReport", payload: { reportId: third[2] }, delaySeconds: 0 });
  });

  it("refuses a fix dated before the report, a missing fixer and a fix with no author", async () => {
    const fix = { clipStorageId: await adminUpload(token, "video/mp4"), frameStorageIds: await adminFrames() };
    const dated = await seed([await videoSample({ createdAt: NOW - 3 * DAY, fix: { ...fix, by: { kind: "resident" }, fixedAt: NOW - 4 * DAY } })]);
    expect(JSON.stringify(dated.body)).toContain("fixed before it was posted");

    for (const by of [{ kind: "fixer", fixerId: crypto.randomUUID() }, { kind: "fixer", fixerId: "garbage" }, { kind: "fixer" }, {}]) {
      expect((await seed([await videoSample({ fix: { ...fix, by } })])).status).toBe(400);
    }
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("queues attachSeedFix after the report's screening, only for samples with a fix clip", async () => {
    const fixer = await fixerRow();
    const fix = { clipStorageId: await adminUpload(token, "video/mp4"), frameStorageIds: await adminFrames(), by: { kind: "fixer", fixerId: fixer.id }, fixedAt: NOW - DAY };
    const { body } = await seed([await videoSample(), await videoSample({ createdAt: NOW - 20 * DAY, fix })]);

    expect(jobs(ATTACH_SEED_FIX)).toEqual([
      {
        name: ATTACH_SEED_FIX,
        payload: { reportId: (body as string[])[1], fix, lastActivityAt: NOW - 20 * DAY, polls: 0 },
        delaySeconds: SCREEN_STAGGER_SECONDS + POLL_SECONDS,
        inTransaction: true,
      },
    ]);
  });
});

async function fixerRow(passcode = crypto.randomUUID()) {
  const [fixer] = await db.insert(fixers).values({ name: "Dana", org: "SF Public Works", passcode }).returning();
  return fixer;
}

describe("seed fix clips", () => {
  // A sample with a fix clip, made open (screening passed) unless told otherwise.
  async function sampleWithFix(by: "resident" | { fixerId: string }, { owner = "cobb", status = "open", fixedAt }: { owner?: "cobb" | "city"; status?: "open" | "held" | "pending"; fixedAt?: number } = {}) {
    const fix = {
      clipStorageId: await adminUpload(token, "video/mp4"),
      frameStorageIds: await adminFrames(),
      by: by === "resident" ? { kind: "resident" } : { kind: "fixer", fixerId: by.fixerId },
      fixedAt,
    };
    const [reportId] = (await seed([await videoSample({ createdAt: NOW - 20 * DAY, lastActivityAt: NOW - 20 * DAY, fix })])).body as string[];
    await db.update(reports).set({ status, category: "pothole", owner, agency: "Cobb DOT", title: "Pothole" }).where(eq(reports.id, reportId));
    const job = jobs(ATTACH_SEED_FIX).at(-1)!;
    return { reportId, fix, payload: job.payload as AttachSeedFixPayload };
  }
  const attempts = () => db.select().from(fixAttempts);

  it("while the report is still pending, polls again and files nothing", async () => {
    const { payload } = await sampleWithFix("resident", { status: "pending" });
    enqueuedJobs.length = 0;

    await attachSeedFix(payload);

    expect(await attempts()).toHaveLength(0);
    expect(enqueuedJobs).toEqual([
      { name: ATTACH_SEED_FIX, payload: { ...payload, polls: 1 }, delaySeconds: POLL_SECONDS, inTransaction: false },
    ]);
  });

  it("stops polling after MAX_POLLS", async () => {
    const { payload } = await sampleWithFix("resident", { status: "pending" });
    enqueuedJobs.length = 0;
    await attachSeedFix({ ...payload, polls: MAX_POLLS - 1 });
    expect(enqueuedJobs).toHaveLength(0);
    expect(await attempts()).toHaveLength(0);
  });

  it("once open, files the attempt at the report's location and queues the real verifyFix", async () => {
    const fixer = await fixerRow();
    const { reportId, fix, payload } = await sampleWithFix({ fixerId: fixer.id });
    enqueuedJobs.length = 0;

    await attachSeedFix(payload);

    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ reportId, byKind: "fixer", byId: fixer.id, clipStorageId: fix.clipStorageId, frameStorageIds: fix.frameStorageIds, status: "checking", ...AT });
    expect(enqueuedJobs).toEqual([{ name: "verifyFix", payload: { fixAttemptId: attempt.id }, delaySeconds: undefined, inTransaction: true }]);
  });

  it("drops the fix when the report was held, or the fixer is gone", async () => {
    const held = await sampleWithFix("resident", { status: "held" });
    await attachSeedFix(held.payload);

    const fixer = await fixerRow();
    const orphaned = await sampleWithFix({ fixerId: fixer.id });
    await db.delete(fixers).where(eq(fixers.id, fixer.id));
    await attachSeedFix(orphaned.payload);

    expect(await attempts()).toHaveLength(0);
  });

  it("a neighbor fix follows §4.3.2: refused on a city-owned report, filed otherwise", async () => {
    const city = await sampleWithFix("resident", { owner: "city" });
    const cobb = await sampleWithFix("resident", { owner: "cobb" });
    await attachSeedFix(city.payload);
    await attachSeedFix(cobb.payload);

    const rows = await attempts();
    expect(rows.map((a) => [a.reportId, a.byKind])).toEqual([[cobb.reportId, "resident"]]);
    expect(await db.select().from(residents).where(eq(residents.id, rows[0].byId))).toHaveLength(1);
  });

  it("queues the backdate only for a fix with a date", async () => {
    const fixer = await fixerRow();
    const plain = await sampleWithFix({ fixerId: fixer.id });
    enqueuedJobs.length = 0;
    await attachSeedFix(plain.payload);
    expect(jobs(BACKDATE_SEED_FIX)).toHaveLength(0);

    const dated = await sampleWithFix({ fixerId: fixer.id }, { fixedAt: NOW - 3 * DAY });
    enqueuedJobs.length = 0;
    await attachSeedFix(dated.payload);
    const [attempt] = (await attempts()).filter((a) => a.reportId === dated.reportId);
    expect(jobs(BACKDATE_SEED_FIX)).toEqual([
      {
        name: BACKDATE_SEED_FIX,
        payload: { attemptId: attempt.id, fixedAt: NOW - 3 * DAY, lastActivityAt: NOW - 20 * DAY, polls: 0 },
        delaySeconds: POLL_SECONDS,
        inTransaction: true,
      },
    ]);
  });

  describe("backdateSeedFix", () => {
    async function checking() {
      const fixer = await fixerRow();
      const { reportId, payload } = await sampleWithFix({ fixerId: fixer.id }, { fixedAt: NOW - 3 * DAY });
      await attachSeedFix(payload);
      const backdate = jobs(BACKDATE_SEED_FIX).at(-1)!.payload as BackdateSeedFixPayload;
      return { reportId, backdate };
    }
    // What the real verifyFix does on `verified`.
    const verify = (reportId: string, attemptId: string, clip: string) =>
      db.transaction(async (tx) => {
        await tx.update(reports).set({ status: "fixed", fixStorageId: clip, fixedAt: NOW, lastActivityAt: NOW }).where(eq(reports.id, reportId));
        await tx.update(fixAttempts).set({ status: "verified" }).where(eq(fixAttempts.id, attemptId));
      });

    it("polls while the check runs, then stamps the seeded date once it verifies", async () => {
      const { reportId, backdate } = await checking();
      enqueuedJobs.length = 0;

      await backdateSeedFix(backdate);
      expect(enqueuedJobs).toEqual([{ name: BACKDATE_SEED_FIX, payload: { ...backdate, polls: 1 }, delaySeconds: POLL_SECONDS, inTransaction: false }]);
      expect(await reportRow(reportId)).toMatchObject({ status: "open", fixedAt: null });

      const [attempt] = await attempts();
      await verify(reportId, attempt.id, attempt.clipStorageId);
      enqueuedJobs.length = 0;
      await backdateSeedFix(backdate);

      expect(await reportRow(reportId)).toMatchObject({ status: "fixed", fixedAt: NOW - 3 * DAY, lastActivityAt: NOW - 3 * DAY });
      expect(enqueuedJobs).toHaveLength(0);
    });

    it("feed order is the later of the seeded activity and the fix date", async () => {
      const { reportId, backdate } = await checking();
      const [attempt] = await attempts();
      await verify(reportId, attempt.id, attempt.clipStorageId);
      await backdateSeedFix({ ...backdate, lastActivityAt: NOW - DAY });
      expect(await reportRow(reportId)).toMatchObject({ fixedAt: NOW - 3 * DAY, lastActivityAt: NOW - DAY });
    });

    it("leaves fixedAt alone when the check didn't verify, or another attempt closed the report", async () => {
      const { reportId, backdate } = await checking();
      const [attempt] = await attempts();

      await db.update(fixAttempts).set({ status: "not_fixed" }).where(eq(fixAttempts.id, attempt.id));
      await backdateSeedFix(backdate);
      expect(await reportRow(reportId)).toMatchObject({ status: "open", fixedAt: null, lastActivityAt: NOW - 20 * DAY });

      await db.update(fixAttempts).set({ status: "verified" }).where(eq(fixAttempts.id, attempt.id));
      await db.update(reports).set({ status: "fixed", fixStorageId: "someone-elses-clip", fixedAt: NOW }).where(eq(reports.id, reportId));
      await backdateSeedFix(backdate);
      expect((await reportRow(reportId)).fixedAt).toBe(NOW);
    });

    it("stops polling after MAX_POLLS", async () => {
      const { backdate } = await checking();
      enqueuedJobs.length = 0;
      await backdateSeedFix({ ...backdate, polls: MAX_POLLS - 1 });
      expect(enqueuedJobs).toHaveLength(0);
    });
  });
});

describe("listSamples (GET /api/admin/samples)", () => {
  it("lists sample reports newest first with their latest fix progress, not resident posts", async () => {
    const [first, second] = (await seed([await videoSample(), await videoSample()])).body as string[];
    await insertReport("poster", { status: "open" });
    // Newest first by when it was saved; a batch saves in one instant, so pin the order.
    await db.update(reports).set({ creationTime: 1 }).where(eq(reports.id, first));
    const [resident] = await db.select().from(residents).limit(1);
    for (const status of ["not_fixed", "checking"] as const) {
      await db.insert(fixAttempts).values({ reportId: first, byKind: "resident", byId: resident.id, clipStorageId: "c", frameStorageIds: [], ...AT, status, reason: status === "checking" ? null : "Still there", createdAt: NOW });
    }

    const { status, body } = await adminApi(token, samplesGet, { method: "GET" });

    expect(status).toBe(200);
    const rows = body as { id: string; status: string; fix: unknown }[];
    expect(rows.map((r) => [r.id, r.status, r.fix])).toEqual([
      [second, "pending", null],
      [first, "pending", { status: "checking", reason: null }],
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual(["agency", "category", "createdAt", "fix", "fixedAt", "id", "lat", "lng", "reason", "status", "title", "verdict"]);
  });
});

describe("fixers (GET/POST /api/admin/fixers)", () => {
  const dana = { name: "Dana", org: "SF Public Works", passcode: "sfpw-1" };

  it("seeds fixers, and seeding again updates them by passcode without duplicating", async () => {
    expect(await adminApi(token, fixersPost, { body: { fixers: [dana, { name: "Lee", org: "SFMTA", passcode: "mta-2" }] } })).toEqual({
      status: 200,
      body: { inserted: 2, updated: 0 },
    });
    expect((await adminApi(token, fixersPost, { body: { fixers: [{ ...dana, org: "SF Recology" }] } })).body).toEqual({ inserted: 0, updated: 1 });

    const { body } = await adminApi(token, fixersGet, { method: "GET" });
    expect(body).toEqual([
      { id: expect.any(String), name: "Dana", org: "SF Recology" },
      { id: expect.any(String), name: "Lee", org: "SFMTA" },
    ]);
  });

  it("never lists passcodes or tokens", async () => {
    await adminApi(token, fixersPost, { body: { fixers: [dana] } });
    expect(JSON.stringify((await adminApi(token, fixersGet, { method: "GET" })).body)).not.toContain("sfpw-1");
  });

  it("refuses a malformed list or a repeated passcode, seeding none", async () => {
    for (const list of [undefined, [], [{ name: "A" }], [{ ...dana, org: "  " }], [dana, { ...dana, name: "Other" }], "x"]) {
      expect((await adminApi(token, fixersPost, { body: { fixers: list } })).status).toBe(400);
    }
    expect(await db.select().from(fixers)).toHaveLength(0);
  });

  it("a seeded fixer can be picked as a sample's author", async () => {
    await adminApi(token, fixersPost, { body: { fixers: [dana] } });
    const [{ id }] = (await adminApi(token, fixersGet, { method: "GET" })).body as { id: string }[];
    const fix = { clipStorageId: await adminUpload(token, "video/mp4"), frameStorageIds: await adminFrames(), by: { kind: "fixer", fixerId: id } };
    expect((await seed([await videoSample({ fix })])).status).toBe(200);
  });
});
