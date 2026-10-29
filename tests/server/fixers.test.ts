import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { fixers, reports, residents, type Report } from "@/server/db/schema";
import { FIXER_TOKEN_HEADER } from "@/lib/data/headers";
import { fixerLogin, fixerReport, fixerSession, openReportsForFixer, seedFixers } from "@/server/fixers";
import { requireFixer } from "@/server/auth";
import { GET as getSession } from "@/app/api/fixers/session/route";
import { GET as getOpenReports } from "@/app/api/fixers/open-reports/route";
import { GET as getReport } from "@/app/api/fixers/report/route";
import { POST as postLogin } from "@/app/api/fixers/login/route";
import { putTestObject } from "./fakes";

// Fixer access (§3.1.2) and the fixer's report views (§5.3.1), ported from tests/convex/fixers.test.ts.

const DANA = { name: "Dana", org: "Mableton Sanitation", passcode: "sanit-4821" };
const LEE = { name: "Lee", org: "Mableton Code Enforcement", passcode: "code-7730" };

async function insertReport(overrides: Partial<typeof reports.$inferInsert> = {}): Promise<Report> {
  const [resident] = await db.insert(residents).values({ token: crypto.randomUUID(), createdAt: 1 }).returning();
  const frame = crypto.randomUUID();
  putTestObject(frame, "frame", "image/jpeg");
  const [row] = await db
    .insert(reports)
    .values({
      residentId: resident.id,
      mediaType: "video",
      frameStorageIds: [frame],
      lat: 33.8158,
      lng: -84.5825,
      owner: "cobb",
      agency: "Cobb DOT",
      title: "Pothole",
      status: "open",
      verdict: "pass",
      reason: "Looks fine",
      audioMuted: false,
      isSample: false,
      meTooCount: 0,
      lastActivityAt: 1,
      revealViews: 0,
      createdAt: 1,
      ...overrides,
    })
    .returning();
  return row;
}

const withFixer = (token: string | null, path: string) =>
  new Request(`https://govtok.test${path}`, { headers: token ? { [FIXER_TOKEN_HEADER]: token } : {} });
const noParams = { params: Promise.resolve({}) };

describe("seedFixers", () => {
  it("inserts fixers, and a re-run updates them by passcode without duplicating or dropping tokens", async () => {
    expect(await seedFixers([DANA, LEE])).toEqual({ inserted: 2, updated: 0 });
    const { token } = await fixerLogin(DANA.passcode);

    expect(await seedFixers([{ ...DANA, org: "Mableton Public Works" }])).toEqual({ inserted: 0, updated: 1 });

    const rows = await db.select().from(fixers);
    expect(rows).toHaveLength(2);
    expect(rows.find((f) => f.passcode === DANA.passcode)).toMatchObject({ org: "Mableton Public Works", token });
  });

  it("rejects an empty passcode and a passcode used twice, inserting nothing", async () => {
    await expect(seedFixers([LEE, { ...DANA, passcode: "  " }])).rejects.toThrow(/empty/);
    await expect(seedFixers([DANA, { ...LEE, passcode: DANA.passcode }])).rejects.toThrow(/used twice/);
    expect(await db.select().from(fixers)).toHaveLength(0);
  });

  it("accepts a short passcode like the spec's 4821", async () => {
    await seedFixers([{ ...DANA, passcode: "4821" }]);
    expect((await fixerLogin("4821")).org).toBe("Mableton Sanitation");
  });
});

describe("fixerLogin", () => {
  it("a wrong passcode fails with the same 401 message as an empty one, and issues no token", async () => {
    await seedFixers([DANA, LEE]);
    for (const passcode of ["nope-0000", "   ", "sanit-482"]) {
      await expect(fixerLogin(passcode)).rejects.toMatchObject({ message: "Wrong passcode", status: 401 });
    }
    expect((await db.select().from(fixers)).every((f) => f.token === null)).toBe(true);
  });

  it("the right passcode returns the org and a token that requireFixer accepts", async () => {
    await seedFixers([DANA]);
    const login = await fixerLogin(` ${DANA.passcode} `);
    expect(login.org).toBe("Mableton Sanitation");
    expect(login.token).toMatch(/^[0-9a-f-]{36}$/);
    expect((await requireFixer(login.token)).name).toBe("Dana");
  });

  it("logging in twice, even at once, returns the same token", async () => {
    await seedFixers([DANA, LEE]);
    const [a, b] = await Promise.all([fixerLogin(DANA.passcode), fixerLogin(DANA.passcode)]);
    expect(b.token).toBe(a.token);
    expect((await fixerLogin(DANA.passcode)).token).toBe(a.token);
    expect((await fixerLogin(LEE.passcode)).token).not.toBe(a.token);
  });
});

describe("routes", () => {
  it("login returns {token, org}, and a bad passcode is a 401 with the message", async () => {
    await seedFixers([DANA]);
    const post = (passcode: unknown) =>
      postLogin(new Request("https://govtok.test/api/fixers/login", { method: "POST", body: JSON.stringify({ passcode }) }), noParams);
    const ok = await post(DANA.passcode);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ org: DANA.org, token: expect.any(String) });
    const bad = await post("nope");
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "Wrong passcode" });
    expect((await post(42)).status).toBe(401);
  });

  it("session returns only the org for a valid token, and null for a bad or missing one", async () => {
    await seedFixers([DANA]);
    const { token } = await fixerLogin(DANA.passcode);
    expect(await (await getSession(withFixer(token, "/api/fixers/session"), noParams)).json()).toEqual({ org: DANA.org });
    expect(await (await getSession(withFixer("stale", "/api/fixers/session"), noParams)).json()).toBeNull();
    expect(await (await getSession(withFixer(null, "/api/fixers/session"), noParams)).json()).toBeNull();
    expect(fixerSession((await db.select().from(fixers))[0])).toEqual({ org: DANA.org });
  });

  it("open-reports and report reject a bad or missing token with a 401", async () => {
    await seedFixers([DANA]);
    const report = await insertReport();
    for (const token of ["forged", null]) {
      const list = await getOpenReports(withFixer(token, "/api/fixers/open-reports"), noParams);
      expect(list.status).toBe(401);
      expect(await list.json()).toEqual({ error: token ? "Invalid fixer token" : "Missing fixer token" });
      const one = await getReport(withFixer(token, `/api/fixers/report?reportId=${report.id}`), noParams);
      expect(one.status).toBe(401);
    }
  });

  it("open-reports returns the list through the route, with no private fields", async () => {
    await seedFixers([DANA]);
    const { token } = await fixerLogin(DANA.passcode);
    await insertReport({ title: "one" });
    const response = await getOpenReports(withFixer(token, "/api/fixers/open-reports"), noParams);
    const body = (await response.json()) as Record<string, unknown>[];
    expect(body.map((r) => r.title)).toEqual(["one"]);
    expect(Object.keys(body[0])).not.toContain("residentId");
  });

  it("report needs a reportId", async () => {
    await seedFixers([DANA]);
    const { token } = await fixerLogin(DANA.passcode);
    const response = await getReport(withFixer(token, "/api/fixers/report"), noParams);
    expect(response.status).toBe(400);
  });
});

describe("openReportsForFixer", () => {
  it("returns every owner's open reports, and only open ones, through the public projection", async () => {
    for (const owner of ["city", "cobb", "utility", "unknown"] as const) await insertReport({ owner, title: `open ${owner}` });
    for (const status of ["pending", "held", "fixed"] as const) await insertReport({ status, title: status });

    const list = await openReportsForFixer();
    expect(list.map((r) => r.title).sort()).toEqual(["open city", "open cobb", "open unknown", "open utility"]);
    for (const report of list) {
      expect(report.status).toBe("open");
      expect(report.frameUrls).toHaveLength(1);
      expect(report.frameUrls[0]).toEqual(expect.any(String));
      expect(report).not.toHaveProperty("residentId");
      expect(report).not.toHaveProperty("verdict");
      expect(report).not.toHaveProperty("reason");
    }
  });
});

describe("fixerReport", () => {
  it("returns an open report, and keeps returning it once it's fixed", async () => {
    const row = await insertReport();
    const open = await fixerReport(row.id);
    expect(open).toMatchObject({ _id: row.id, status: "open" });
    expect(open).not.toHaveProperty("residentId");

    await db.update(reports).set({ status: "fixed", fixedAt: 2, fixedByKind: "resident" });
    expect(await fixerReport(row.id)).toMatchObject({ status: "fixed", fixedByLabel: "neighbor" });
  });

  it("is null for a pending, held, deleted or malformed report ID", async () => {
    const pending = await insertReport({ status: "pending" });
    const held = await insertReport({ status: "held" });
    for (const id of [pending.id, held.id, crypto.randomUUID(), "not-an-id"]) {
      expect(await fixerReport(id)).toBeNull();
    }
  });
});
