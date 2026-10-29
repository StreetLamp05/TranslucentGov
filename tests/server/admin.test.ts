import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "@/app/api/admin/login/route";
import { POST as releaseRoute } from "@/app/api/admin/release/route";
import { POST as rescreenRoute } from "@/app/api/admin/rescreen/route";
import { POST as uploadUrlRoute } from "@/app/api/admin/upload-url/route";
import { db } from "@/server/db";
import { uploads, videoIntakeAdminSessions } from "@/server/db/schema";
import { ADMIN_SESSION_MS } from "@/server/lib/auth";
import { adminApi, ADMIN_PASSCODE, loginAdmin } from "./admin";
import { api, insertReport, reportRow } from "./api";
import { enqueuedJobs } from "./fakes";

// The admin login and session (ported from convex/videoIntake.test.ts), uploads, and the
// operator tools rescreen / release (convex/screeningDb.ts, §4.2.1).

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSCODE", ADMIN_PASSCODE);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/login", () => {
  it("issues a random 30-minute session for the configured passcode", async () => {
    const before = Date.now();
    const { status, body } = await api(loginRoute, { body: { passcode: ADMIN_PASSCODE } });
    const { token, expiresAt } = body as { token: string; expiresAt: number };

    expect(status).toBe(200);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(expiresAt).toBeGreaterThanOrEqual(before + ADMIN_SESSION_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + ADMIN_SESSION_MS);
    expect(await db.select().from(videoIntakeAdminSessions)).toMatchObject([{ token, expiresAt }]);

    const second = (await api(loginRoute, { body: { passcode: ADMIN_PASSCODE } })).body as { token: string };
    expect(second.token).not.toBe(token);
  });

  for (const passcode of ["wrong-passcode", "", ADMIN_PASSCODE.slice(0, -1), 12, null]) {
    it(`rejects ${JSON.stringify(passcode)} with a 401 and creates no session`, async () => {
      expect(await api(loginRoute, { body: { passcode } })).toEqual({
        status: 401,
        body: { error: "Invalid admin passcode." },
      });
      expect(await db.select().from(videoIntakeAdminSessions)).toHaveLength(0);
    });
  }

  it("rejects everything when ADMIN_PASSCODE isn't set", async () => {
    vi.stubEnv("ADMIN_PASSCODE", "");
    expect((await api(loginRoute, { body: { passcode: "" } })).status).toBe(401);
  });
});

describe("the session slides", () => {
  const MIN = 60_000;
  const call = (token: string) => adminApi(token, uploadUrlRoute, { body: { contentType: "video/mp4" } });
  const expiry = async (token: string) =>
    (await db.select().from(videoIntakeAdminSessions).where(eq(videoIntakeAdminSessions.token, token)))[0].expiresAt;
  const T0 = Date.UTC(2026, 9, 29, 12);

  beforeEach(() => {
    // Only the clock: PGlite needs real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a call at 29 minutes pushes the expiry to 30 minutes from then", async () => {
    const token = await loginAdmin();
    expect(await expiry(token)).toBe(T0 + 30 * MIN);

    vi.setSystemTime(T0 + 29 * MIN);
    expect((await call(token)).status).toBe(200);
    expect(await expiry(token)).toBe(T0 + 59 * MIN);

    // 58 minutes after login, and still in: only idle time counts.
    vi.setSystemTime(T0 + 58 * MIN);
    expect((await call(token)).status).toBe(200);
  });

  it("30 idle minutes end it, and a rejected call doesn't revive it", async () => {
    const token = await loginAdmin();

    vi.setSystemTime(T0 + 31 * MIN);
    expect(await call(token)).toEqual({ status: 401, body: { error: "Admin session expired. Sign in again." } });
    expect(await expiry(token)).toBe(T0 + 30 * MIN);

    vi.setSystemTime(T0 + 32 * MIN);
    expect((await call(token)).status).toBe(401);
  });

  it("exactly at expiry is out, a second before is in", async () => {
    const token = await loginAdmin();
    vi.setSystemTime(T0 + 30 * MIN - 1000);
    expect((await call(token)).status).toBe(200);
    vi.setSystemTime(T0 + 60 * MIN - 1000);
    expect((await call(token)).status).toBe(401);
  });
});

describe("admin routes need a session", () => {
  it("answers a missing token 'Admin login required.' and an unknown or expired one 'Admin session expired.'", async () => {
    const expired = "e".repeat(64);
    await db.insert(videoIntakeAdminSessions).values({ token: expired, expiresAt: Date.now() - 1 });

    expect(await adminApi(null, uploadUrlRoute, { body: { contentType: "video/mp4" } })).toEqual({
      status: 401,
      body: { error: "Admin login required." },
    });
    for (const token of ["invalid", expired]) {
      expect(await adminApi(token, uploadUrlRoute, { body: { contentType: "video/mp4" } })).toEqual({
        status: 401,
        body: { error: "Admin session expired. Sign in again." },
      });
    }
  });

  it("a resident's device token is not a session", async () => {
    expect((await api(uploadUrlRoute, { token: "resident", body: { contentType: "video/mp4" } })).status).toBe(401);
  });
});

describe("POST /api/admin/upload-url", () => {
  it("signs a PUT URL for the right type and records the key as an admin upload", async () => {
    const token = await loginAdmin();
    const { status, body } = await adminApi(token, uploadUrlRoute, { body: { contentType: "video/mp4" } });
    const { key, url } = body as { key: string; url: string };

    expect(status).toBe(200);
    expect(url).toContain(key);
    expect(await db.select().from(uploads).where(eq(uploads.key, key))).toMatchObject([
      { uploaderKind: "admin", uploaderId: null, contentType: "video/mp4" },
    ]);
  });

  it.each(["text/html", "application/json", "", 5, undefined])("refuses %j: only media", async (contentType) => {
    const token = await loginAdmin();
    const { status } = await adminApi(token, uploadUrlRoute, { body: { contentType } });
    expect(status).toBe(400);
    expect(await db.select().from(uploads)).toHaveLength(0);
  });
});

describe("rescreen", () => {
  const rescreen = async (token: string, reportId: unknown) => adminApi(token, rescreenRoute, { body: { reportId } });

  it.each(["held", "pending"] as const)("puts a %s report back to pending, clears the old result and queues screenReport", async (status) => {
    const token = await loginAdmin();
    const report = await insertReport("poster", {
      status,
      verdict: "retake",
      reason: "Too dark",
      screeningError: "boom",
      category: "pothole",
      title: "Pothole",
    });

    expect(await rescreen(token, report.id)).toEqual({ status: 200, body: null });

    expect(await reportRow(report.id)).toMatchObject({ status: "pending", verdict: null, reason: null, screeningError: null });
    expect(enqueuedJobs).toEqual([
      { name: "screenReport", payload: { reportId: report.id }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it.each(["open", "fixed"] as const)("refuses a %s report, which would drop off the feed", async (status) => {
    const token = await loginAdmin();
    const report = await insertReport("poster", { status });
    const { status: code, body } = await rescreen(token, report.id);
    expect(code).toBe(409);
    expect(body).toEqual({ error: `Only a held or pending report can be rescreened (this one is ${status}).` });
    expect(await reportRow(report.id)).toMatchObject({ status });
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("answers 'No such report.' for an unknown or malformed id, not a server error", async () => {
    const token = await loginAdmin();
    for (const id of [crypto.randomUUID(), "garbage", 5, undefined]) {
      expect(await rescreen(token, id)).toEqual({ status: 404, body: { error: "No such report." } });
    }
  });

  it("needs a session", async () => {
    const report = await insertReport("poster", { status: "held" });
    expect((await rescreen("nope", report.id)).status).toBe(401);
    expect(await reportRow(report.id)).toMatchObject({ status: "held" });
  });
});

describe("release", () => {
  const held = (fields: Parameters<typeof insertReport>[1] = {}) =>
    insertReport("poster", { status: "held", category: "pothole", title: "Pothole", lastActivityAt: 5, ...fields });
  const release = async (token: string, reportId: unknown, force?: unknown) =>
    adminApi(token, releaseRoute, { body: { reportId, force } });

  it("publishes a held report and moves it to the top of the feed", async () => {
    const token = await loginAdmin();
    const report = await held({ verdict: "pass" });
    const before = Date.now();

    expect(await release(token, report.id)).toEqual({ status: 200, body: null });

    const row = await reportRow(report.id);
    expect(row.status).toBe("open");
    expect(row.lastActivityAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps a sample's backdated order", async () => {
    const token = await loginAdmin();
    const report = await held({ isSample: true });
    await release(token, report.id);
    expect(await reportRow(report.id)).toMatchObject({ status: "open", lastActivityAt: 5 });
  });

  it.each(["retake", "reject", "emergency"] as const)("needs force for a %s verdict", async (verdict) => {
    const token = await loginAdmin();
    const report = await held({ verdict, reason: "Faces visible" });

    const refused = await release(token, report.id);
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toContain(`held as ${verdict} ("Faces visible")`);
    expect(await reportRow(report.id)).toMatchObject({ status: "held" });

    // Only a literal true counts.
    expect((await release(token, report.id, "yes")).status).toBe(409);
    expect((await release(token, report.id, true)).status).toBe(200);
    expect(await reportRow(report.id)).toMatchObject({ status: "open" });
  });

  it("refuses a report with no category or title: rescreen it instead", async () => {
    const token = await loginAdmin();
    const report = await held({ category: null, title: null, reason: "Screening failed" });
    const { status, body } = await release(token, report.id, true);
    expect(status).toBe(409);
    expect(body).toEqual({ error: "This report has no category or title yet. Rescreen it instead." });
  });

  it("refuses a report that isn't held, and an unknown or malformed id", async () => {
    const token = await loginAdmin();
    const open = await insertReport("poster", { status: "open" });
    expect(await release(token, open.id)).toEqual({
      status: 409,
      body: { error: "Only a held report can be released (this one is open)." },
    });
    for (const id of [crypto.randomUUID(), "garbage"]) {
      expect(await release(token, id)).toEqual({ status: 404, body: { error: "No such report." } });
    }
  });
});
