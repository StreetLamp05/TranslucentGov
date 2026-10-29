import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { FIXER_TOKEN_HEADER, RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { db } from "@/server/db";
import { fixAttempts, fixers, reports, residents, type Report } from "@/server/db/schema";
import { createProofUploadUrl, myFixAttempt, submitFix, type By } from "@/server/fixes";
import { createUploadUrl } from "@/server/storage";
import { CITY_ONLY, tooFarMessage } from "@/server/lib/fixRules";
import type { Owner } from "@/server/lib/routing";
import { POST as postFix } from "@/app/api/fixes/route";
import { POST as postUploadUrl } from "@/app/api/fixes/upload-url/route";
import { GET as getAttempt } from "@/app/api/fixes/attempt/route";
import { enqueuedJobs, putTestObject } from "./fakes";

// Proof of fix (§4.3.1, §4.3.2), ported from tests/convex/fixes.test.ts. The verifyFix job
// itself is US36's; here it is only enqueued, recorded by tests/server/fakes.ts.

const REPORT = { lat: 33.8158, lng: -84.5825 };
// ~111 m per 0.001° of latitude.
const metersNorth = (m: number) => ({ lat: REPORT.lat + m / 111_000, lng: REPORT.lng });
const noParams = { params: Promise.resolve({}) };

let fixer: By;
let otherFixer: By;
let neighbor: By;
let otherNeighbor: By;
let fixerToken: string;

async function insertReport(owner: Owner, status: Report["status"]): Promise<Report> {
  const [poster] = await db.insert(residents).values({ token: "poster", createdAt: 1 }).returning();
  const [row] = await db
    .insert(reports)
    .values({
      residentId: poster.id,
      mediaType: "video",
      frameStorageIds: ["before"],
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
    })
    .returning();
  return row;
}

/** Uploads a file the way the browser does: a presigned URL, then the PUT. */
async function upload(by: By, contentType: string): Promise<string> {
  const { key } = await createUploadUrl(contentType, by);
  putTestObject(key, "bytes", contentType);
  return key;
}

beforeEach(async () => {
  const [a, b] = await db
    .insert(fixers)
    .values([
      { name: "Dana", org: "Mableton Sanitation", passcode: "4821", token: "fixer-token" },
      { name: "Lee", org: "Cobb DOT", passcode: "5555", token: "other-fixer" },
    ])
    .returning();
  const [c, d] = await db
    .insert(residents)
    .values([
      { token: "neighbor", createdAt: 1 },
      { token: "other-neighbor", createdAt: 1 },
    ])
    .returning();
  fixer = { kind: "fixer", id: a.id };
  otherFixer = { kind: "fixer", id: b.id };
  neighbor = { kind: "resident", id: c.id };
  otherNeighbor = { kind: "resident", id: d.id };
  fixerToken = "fixer-token";
});

async function setup({ owner = "cobb", status = "open" }: { owner?: Owner; status?: Report["status"] } = {}) {
  const report = await insertReport(owner, status);
  const submit = async (by: By, at = metersNorth(10), overrides: Record<string, unknown> = {}) =>
    submitFix(by, {
      reportId: report.id,
      clipStorageId: await upload(by, "video/webm"),
      frameStorageIds: [await upload(by, "image/jpeg"), await upload(by, "image/jpeg")],
      ...at,
      ...overrides,
    });
  const attempts = () => db.select().from(fixAttempts);
  return { report, submit, attempts };
}

describe("submitFix", () => {
  it("rejects a clip filmed more than 50 m from the report, saving and queueing nothing", async () => {
    const { submit, attempts } = await setup();
    await expect(submit(fixer, metersNorth(60))).rejects.toThrow(/Get within 50 m \(you're 6\d m away\)/);
    expect(await attempts()).toHaveLength(0);
    expect(enqueuedJobs).toHaveLength(0);
  });

  it("accepts a clip just inside 50 m", async () => {
    const { submit } = await setup();
    await expect(submit(fixer, metersNorth(49))).resolves.toEqual(expect.any(String));
  });

  it.each(["fixed", "pending", "held"] as const)("rejects a report that's %s", async (status) => {
    const { submit, attempts } = await setup({ status });
    await expect(submit(fixer)).rejects.toThrow(/isn't open/);
    expect(await attempts()).toHaveLength(0);
  });

  it("rejects a malformed or unknown report ID", async () => {
    const { submit } = await setup();
    await expect(submit(fixer, metersNorth(10), { reportId: "garbage" })).rejects.toThrow(/isn't open/);
    await expect(submit(fixer, metersNorth(10), { reportId: crypto.randomUUID() })).rejects.toThrow(/isn't open/);
  });

  it("rejects a resident on a city-owned report (§4.3.2)", async () => {
    const { submit, attempts } = await setup({ owner: "city" });
    await expect(submit(neighbor)).rejects.toThrow(CITY_ONLY);
    expect(await attempts()).toHaveLength(0);
  });

  it.each(["cobb", "utility", "unknown"] as const)("accepts a resident on a %s report", async (owner) => {
    const { submit, attempts } = await setup({ owner });
    const attemptId = await submit(neighbor);
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({ id: attemptId, byKind: "resident", byId: neighbor.id, status: "checking" });
  });

  it.each(["city", "cobb", "utility", "unknown"] as const)("accepts a fixer on a %s report", async (owner) => {
    const { submit, attempts, report } = await setup({ owner });
    await submit(fixer);
    const [attempt] = await attempts();
    expect(attempt).toMatchObject({
      reportId: report.id,
      byKind: "fixer",
      byId: fixer.id,
      status: "checking",
      lat: metersNorth(10).lat,
      lng: REPORT.lng,
      reason: null,
    });
    expect(attempt.frameStorageIds).toHaveLength(2);
  });

  it("queues verifyFix for the new attempt, in the same transaction", async () => {
    const { submit } = await setup();
    const attemptId = await submit(fixer);
    expect(enqueuedJobs).toEqual([
      { name: "verifyFix", payload: { fixAttemptId: attemptId }, delaySeconds: undefined, inTransaction: true },
    ]);
  });

  it("rejects files of the wrong kind, a missing file and a bad frame count", async () => {
    const { submit, attempts } = await setup();
    const frame = await upload(fixer, "image/jpeg");
    const clip = await upload(fixer, "video/webm");
    await expect(submit(fixer, metersNorth(10), { clipStorageId: frame })).rejects.toThrow(/isn't a video/);
    await expect(submit(fixer, metersNorth(10), { frameStorageIds: [clip] })).rejects.toThrow(/isn't an image/);
    await expect(submit(fixer, metersNorth(10), { frameStorageIds: [] })).rejects.toThrow(/1 to 6 frames/);
    await expect(submit(fixer, metersNorth(10), { frameStorageIds: Array(7).fill(frame) })).rejects.toThrow(/1 to 6 frames/);
    await expect(submit(fixer, metersNorth(10), { frameStorageIds: [crypto.randomUUID()] })).rejects.toThrow(/file is missing/);
    await expect(submit(fixer, metersNorth(10), { frameStorageIds: "x" })).rejects.toThrow(/1 to 6 frames/);
    expect(await attempts()).toHaveLength(0);
  });

  it("rejects a key someone else uploaded, and a key nobody asked a URL for", async () => {
    const { submit, report } = await setup();
    const theirs = await upload(otherNeighbor, "image/jpeg");
    await expect(submit(neighbor, metersNorth(10), { frameStorageIds: [theirs] })).rejects.toThrow(/file is missing/);
    // Present in the bucket but never issued by createUploadUrl.
    putTestObject("rogue", "bytes", "video/webm");
    await expect(submit(fixer, metersNorth(10), { clipStorageId: "rogue" })).rejects.toThrow(/file is missing/);
    // A resident's upload isn't a fixer's, even with the same row id space.
    const asResident = await upload({ kind: "resident", id: fixer.id }, "video/webm");
    await expect(submit(fixer, metersNorth(10), { clipStorageId: asResident })).rejects.toThrow(/file is missing/);
    expect(report.status).toBe("open");
  });

  it("rejects an oversized clip", async () => {
    const { submit } = await setup();
    const { key } = await createUploadUrl("video/webm", fixer);
    putTestObject(key, new Uint8Array(26_000_000), "video/webm");
    await expect(submit(fixer, metersNorth(10), { clipStorageId: key })).rejects.toThrow(/over 25 MB/);
  });

  it("rejects non-numeric or out-of-range coordinates", async () => {
    const { submit } = await setup();
    for (const at of [{ lat: "33.8", lng: -84.5 }, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: null, lng: null }]) {
      await expect(submit(fixer, at as { lat: number; lng: number })).rejects.toThrow(/isn't valid/);
    }
  });
});

describe("tooFarMessage", () => {
  it("rounds up, so a distance just past 50 m never reads as 50 m", () => {
    expect(tooFarMessage(50.3, 50)).toBe("Get within 50 m (you're 51 m away)");
    expect(tooFarMessage(120, 50)).toBe("Get within 50 m (you're 120 m away)");
  });
});

describe("createProofUploadUrl", () => {
  it("issues a URL for video and image types only", async () => {
    for (const type of ["video/webm", "video/mp4", "image/jpeg"]) {
      expect(await createProofUploadUrl(fixer, type)).toEqual({ key: expect.any(String), url: expect.stringContaining("https://govtok.test") });
    }
    for (const type of ["text/html", "image/svg+xml; x", "", "video", 5, undefined]) {
      await expect(createProofUploadUrl(fixer, type)).rejects.toThrow(/Only video and image/);
    }
  });
});

describe("myFixAttempt", () => {
  async function submitted(by: By) {
    const s = await setup();
    return { ...s, attemptId: await s.submit(by) };
  }

  it("returns a fixer's attempt to that fixer, and null to anyone else", async () => {
    const { attemptId, report } = await submitted(fixer);
    expect(await myFixAttempt(fixer, attemptId)).toEqual({ reportId: report.id, status: "checking", reason: undefined });
    expect(await myFixAttempt(otherFixer, attemptId)).toBeNull();
    expect(await myFixAttempt({ kind: "resident", id: fixer.id }, attemptId)).toBeNull();
    expect(await myFixAttempt(neighbor, attemptId)).toBeNull();
    expect(await myFixAttempt(null, attemptId)).toBeNull();
  });

  it("returns a neighbor's attempt to that neighbor, and null to anyone else", async () => {
    const { attemptId, report } = await submitted(neighbor);
    expect(await myFixAttempt(neighbor, attemptId)).toEqual({ reportId: report.id, status: "checking", reason: undefined });
    expect(await myFixAttempt(otherNeighbor, attemptId)).toBeNull();
    expect(await myFixAttempt(fixer, attemptId)).toBeNull();
  });

  it("is null for a malformed or unknown ID", async () => {
    await submitted(fixer);
    expect(await myFixAttempt(fixer, "garbage")).toBeNull();
    expect(await myFixAttempt(fixer, crypto.randomUUID())).toBeNull();
  });

  it("carries Claude's reason back once the check settles", async () => {
    const { attemptId } = await submitted(fixer);
    await db.update(fixAttempts).set({ status: "not_fixed", reason: "The pothole is still there." }).where(eq(fixAttempts.id, attemptId));
    expect(await myFixAttempt(fixer, attemptId)).toMatchObject({ status: "not_fixed", reason: "The pothole is still there." });
  });
});

describe("routes", () => {
  const post = (path: string, body: unknown, headers: Record<string, string>) =>
    new Request(`https://govtok.test${path}`, { method: "POST", body: JSON.stringify(body), headers });

  it("upload, submit and read back an attempt as a fixer", async () => {
    const { report } = await setup();
    const headers = { [FIXER_TOKEN_HEADER]: fixerToken };
    const slot = async (contentType: string) => {
      const response = await postUploadUrl(post("/api/fixes/upload-url", { as: "fixer", contentType }, headers), noParams);
      expect(response.status).toBe(200);
      const { key } = (await response.json()) as { key: string };
      putTestObject(key, "bytes", contentType);
      return key;
    };
    const submitted = await postFix(
      post("/api/fixes", { as: "fixer", reportId: report.id, clipStorageId: await slot("video/webm"), frameStorageIds: [await slot("image/jpeg")], ...metersNorth(5) }, headers),
      noParams,
    );
    expect(submitted.status).toBe(200);
    const attemptId = (await submitted.json()) as string;

    const read = (as: string, h: Record<string, string>) =>
      getAttempt(new Request(`https://govtok.test/api/fixes/attempt?attemptId=${attemptId}&as=${as}`, { headers: h }), noParams);
    expect(await (await read("fixer", headers)).json()).toEqual({ reportId: report.id, status: "checking" });
    expect(await (await read("fixer", { [FIXER_TOKEN_HEADER]: "forged" })).json()).toBeNull();
    expect(await (await read("resident", { [RESIDENT_TOKEN_HEADER]: "neighbor" })).json()).toBeNull();
  });

  it("a missing or bad token is a 401, and a missing kind is too", async () => {
    const { report } = await setup();
    const body = { reportId: report.id, clipStorageId: "k", frameStorageIds: ["k"], ...metersNorth(5) };
    const noToken = await postFix(post("/api/fixes", { as: "fixer", ...body }, {}), noParams);
    expect(noToken.status).toBe(401);
    expect(await noToken.json()).toEqual({ error: "Missing fixer token" });
    const forged = await postFix(post("/api/fixes", { as: "fixer", ...body }, { [FIXER_TOKEN_HEADER]: "forged" }), noParams);
    expect(forged.status).toBe(401);
    const noKind = await postFix(post("/api/fixes", body, { [FIXER_TOKEN_HEADER]: fixerToken }), noParams);
    expect(noKind.status).toBe(401);
    expect(await noKind.json()).toEqual({ error: "Missing token" });
    const noDevice = await postFix(post("/api/fixes", { as: "resident", ...body }, {}), noParams);
    expect(noDevice.status).toBe(401);
  });

  it("a brand-new device can confirm (its resident row is created)", async () => {
    const { report } = await setup();
    const headers = { [RESIDENT_TOKEN_HEADER]: "new-device" };
    const slot = await postUploadUrl(post("/api/fixes/upload-url", { as: "resident", contentType: "video/webm" }, headers), noParams);
    expect(slot.status).toBe(200);
    expect(await db.select().from(residents).where(eq(residents.token, "new-device"))).toHaveLength(1);
    expect(report.id).toBeTruthy();
  });
});
