import { S3Client } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { fixAttempts, meToos, reports, uploads, videoIntake, videoIntakeAdminSessions, type Report } from "@/server/db/schema";
import { PURGE_CRON, PURGE_EXPIRED, purgeExpired as purgeExpiredJob } from "@/server/jobs/purgeExpired";
import { BATCH, INTAKE_RETENTION_MS, PURGE_AFTER_MS, purgeExpired } from "@/server/purge";
import { insertReport, insertResident } from "./reports";
import { fakeS3Send, objects, putTestObject } from "./fakes";

// The nightly retention job (§7.1.1), ported from tests/convex/purge.test.ts.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.mocked(console.log).mockRestore();
  vi.mocked(console.error).mockRestore();
});

// An object in the bucket that was uploaded `ageMs` before NOW (its `uploads` row says so).
async function file(ageMs: number, kind: "video" | "image" = "image"): Promise<string> {
  const key = crypto.randomUUID();
  putTestObject(key, "bytes", kind === "video" ? "video/mp4" : "image/jpeg");
  await db.insert(uploads).values({ key, uploaderKind: "admin", contentType: "x", createdAt: NOW - ageMs });
  return key;
}

type Made = { report: Report; keys: string[] };

async function report(
  status: Report["status"],
  ageMs: number,
  { isSample = false, filesAgeMs = ageMs, fileCount = 3 }: { isSample?: boolean; filesAgeMs?: number; fileCount?: number } = {},
): Promise<Made> {
  const resident = await insertResident();
  const clip = await file(filesAgeMs, "video");
  const frames = await Promise.all(Array.from({ length: fileCount - 1 }, () => file(filesAgeMs)));
  const row = await insertReport(resident.id, {
    status,
    isSample,
    clipStorageId: clip,
    frameStorageIds: frames,
    createdAt: NOW - ageMs,
    lastActivityAt: NOW - ageMs,
    meTooCount: 1,
  });
  await db.insert(meToos).values({ reportId: row.id, residentId: resident.id, createdAt: NOW - ageMs });
  return { report: row, keys: [clip, ...frames] };
}

async function attempt(reportId: string, status: (typeof fixAttempts.$inferSelect)["status"], ageMs: number) {
  const resident = await insertResident();
  const clip = await file(ageMs, "video");
  const frame = await file(ageMs);
  const [row] = await db
    .insert(fixAttempts)
    .values({ reportId, byKind: "resident", byId: resident.id, clipStorageId: clip, frameStorageIds: [frame], lat: 33.8, lng: -84.5, status, createdAt: NOW - ageMs })
    .returning();
  return { attempt: row, keys: [clip, frame] };
}

const present = (keys: string[]) => keys.map((key) => objects.has(key));
const reportExists = async (id: string) => (await db.select().from(reports).where(eq(reports.id, id))).length === 1;
const meTooCount = async (id: string) => (await db.select().from(meToos).where(eq(meToos.reportId, id))).length;
const attemptExists = async (id: string) => (await db.select().from(fixAttempts).where(eq(fixAttempts.id, id))).length === 1;

async function expectReportGone({ report: r, keys }: Made) {
  expect(await reportExists(r.id)).toBe(false);
  expect(present(keys)).toEqual(keys.map(() => false));
  expect(await meTooCount(r.id)).toBe(0);
  // The upload records go with the objects.
  expect(await db.select().from(uploads).where(eq(uploads.key, keys[0]))).toHaveLength(0);
}
async function expectReportKept({ report: r, keys }: Made) {
  expect(await reportExists(r.id)).toBe(true);
  expect(present(keys)).toEqual(keys.map(() => true));
  expect(await meTooCount(r.id)).toBe(1);
}

describe("purgeExpired", () => {
  it("purges an 8-day-old held report with its files and me-toos; keeps newer held, published reports and verified fixes", async () => {
    const oldOpen = await report("open", 30 * DAY);
    const oldFixed = await report("fixed", 30 * DAY);
    const verified = await attempt(oldFixed.report.id, "verified", 20 * DAY);
    const oldHeld = await report("held", 8 * DAY);
    const unverified = [];
    for (const status of ["checking", "not_fixed", "retake", "failed", "superseded"] as const) {
      unverified.push(await attempt(oldOpen.report.id, status, 8 * DAY));
    }
    const newHeld = await report("held", 6 * DAY);
    const recentRetake = await attempt(oldOpen.report.id, "retake", 6 * DAY);

    const result = await purgeExpired(NOW);

    expect(result).toMatchObject({ reports: 1, attempts: 5, more: false, failures: 0 });
    await expectReportGone(oldHeld);
    for (const kept of [newHeld, oldOpen, oldFixed]) await expectReportKept(kept);
    // A verified attempt keeps its clip; old attempts in every other status go; a 6-day-old one stays.
    expect(await attemptExists(verified.attempt.id)).toBe(true);
    expect(present(verified.keys)).toEqual([true, true]);
    for (const gone of unverified) {
      expect(await attemptExists(gone.attempt.id)).toBe(false);
      expect(present(gone.keys)).toEqual([false, false]);
    }
    expect(await attemptExists(recentRetake.attempt.id)).toBe(true);
    expect(present(recentRetake.keys)).toEqual([true, true]);
  });

  it("never purges a held sample, however old", async () => {
    const sample = await report("held", 30 * DAY, { isSample: true });
    await purgeExpired(NOW);
    await expectReportKept(sample);
  });

  it("a retake restarts the clock: an 8-day-old held report with 1-day-old files is kept", async () => {
    const retaken = await report("held", 8 * DAY, { filesAgeMs: 1 * DAY });
    await purgeExpired(NOW);
    await expectReportKept(retaken);
  });

  it("exactly 7 days old is kept; a second older is purged", async () => {
    const owner = await report("open", 30 * DAY);
    const overReport = await report("held", PURGE_AFTER_MS + 1000);
    const overAttempt = await attempt(owner.report.id, "not_fixed", PURGE_AFTER_MS + 1000);
    // Each guard on its own: posted exactly 7 days ago (older files), and a single file uploaded
    // exactly 7 days ago (older post).
    const postedAt = await report("held", PURGE_AFTER_MS, { filesAgeMs: PURGE_AFTER_MS + 1000 });
    const uploadedAt = await report("held", PURGE_AFTER_MS + 1000, { filesAgeMs: PURGE_AFTER_MS, fileCount: 1 });
    const atAttempt = await attempt(owner.report.id, "not_fixed", PURGE_AFTER_MS);

    await purgeExpired(NOW);

    await expectReportGone(overReport);
    expect(await attemptExists(overAttempt.attempt.id)).toBe(false);
    await expectReportKept(postedAt);
    await expectReportKept(uploadedAt);
    expect(await attemptExists(atAttempt.attempt.id)).toBe(true);
  });

  it("a held report whose files were already deleted is still purged", async () => {
    const oldHeld = await report("held", 8 * DAY);
    for (const key of oldHeld.keys) {
      objects.delete(key);
      await db.delete(uploads).where(eq(uploads.key, key));
    }
    await purgeExpired(NOW);
    expect(await reportExists(oldHeld.report.id)).toBe(false);
  });

  it("takes a held report's fix attempts and their files with it", async () => {
    const oldHeld = await report("held", 8 * DAY);
    const a = await attempt(oldHeld.report.id, "verified", 8 * DAY);
    await purgeExpired(NOW);
    expect(await attemptExists(a.attempt.id)).toBe(false);
    expect(present(a.keys)).toEqual([false, false]);
  });

  it("purges pending, open and fixed reports never, however old", async () => {
    const kept = [await report("pending", 30 * DAY), await report("open", 30 * DAY), await report("fixed", 30 * DAY)];
    await purgeExpired(NOW);
    for (const k of kept) await expectReportKept(k);
  });

  it("removes intake videos older than 7 days with their objects, and keeps newer ones", async () => {
    const entry = async (ageMs: number) => {
      const key = await file(ageMs, "video");
      const [row] = await db
        .insert(videoIntake)
        .values({ storageId: key, fileName: "a.mp4", contentType: "video/mp4", fileSize: 5, status: "complete", transcript: "t", createdAt: NOW - ageMs, updatedAt: NOW })
        .returning();
      return { id: row.id, key };
    };
    const old = await entry(INTAKE_RETENTION_MS + 1000);
    const recent = await entry(INTAKE_RETENTION_MS - DAY);
    const gone = await entry(9 * DAY);
    objects.delete(gone.key); // an object that's already gone doesn't wedge the job

    expect(await purgeExpired(NOW)).toMatchObject({ intake: 2, failures: 0 });

    expect(await db.select({ id: videoIntake.id }).from(videoIntake)).toEqual([{ id: recent.id }]);
    expect(objects.has(old.key)).toBe(false);
    expect(objects.has(recent.key)).toBe(true);
  });

  it("clears expired admin sessions and keeps live ones", async () => {
    await db.insert(videoIntakeAdminSessions).values([
      { token: "expired", expiresAt: NOW - 1 },
      { token: "at-expiry", expiresAt: NOW },
      { token: "live", expiresAt: NOW + 60_000 },
    ]);
    expect(await purgeExpired(NOW)).toMatchObject({ sessions: 2 });
    expect((await db.select().from(videoIntakeAdminSessions)).map((s) => s.token)).toEqual(["live"]);
  });

  it("when one item can't be deleted, deletes the rest and reports the failure", async () => {
    const stuck = await report("held", 9 * DAY);
    const other = await report("held", 8 * DAY);
    // The oldest report's first object fails to delete (MinIO down for one call).
    vi.mocked(S3Client.prototype.send).mockImplementationOnce(async () => {
      throw new Error("minio unreachable");
    });

    const result = await purgeExpired(NOW);

    expect(result).toMatchObject({ reports: 1, failures: 1 });
    // Its row stays, so the next run retries it.
    expect(await reportExists(stuck.report.id)).toBe(true);
    await expectReportGone(other);
    expect(await purgeExpired(NOW)).toMatchObject({ reports: 1, failures: 0 });
    await expectReportGone(stuck);
  });
});

describe("the purgeExpired job", () => {
  it("is named purgeExpired and runs daily at 10:00 UTC", () => {
    expect(PURGE_EXPIRED).toBe("purgeExpired");
    expect(PURGE_CRON).toBe("0 10 * * *");
  });

  it("drains a backlog bigger than one batch, even with skipped rows in the way", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      // Old samples sort first, so they'd fill every batch if skips counted.
      const samples = [];
      for (let i = 0; i < BATCH + 10; i++) samples.push(await report("held", 9 * DAY, { isSample: true, fileCount: 1 }));
      for (let i = 0; i < BATCH + 10; i++) await report("held", 8 * DAY, { fileCount: 1 });

      await purgeExpiredJob();

      const left = await db.select({ id: reports.id }).from(reports);
      expect(left.map((r) => r.id).sort()).toEqual(samples.map((s) => s.report.id).sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws after finishing when some items couldn't be deleted, and doesn't loop on them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      await report("held", 8 * DAY, { fileCount: 1 });
      vi.mocked(S3Client.prototype.send).mockImplementation(async () => {
        throw new Error("minio unreachable");
      });
      await expect(purgeExpiredJob()).rejects.toThrow("1 items couldn't be deleted");
    } finally {
      vi.mocked(S3Client.prototype.send).mockImplementation(fakeS3Send);
      vi.useRealTimers();
    }
  });
});
