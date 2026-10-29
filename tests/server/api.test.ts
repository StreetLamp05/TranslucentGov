import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GET as getFeed } from "@/app/api/feed/route";
import { GET as getFeedReport } from "@/app/api/feed/[id]/route";
import { GET as getMap } from "@/app/api/map/route";
import { GET as getMeToos } from "@/app/api/me/me-toos/route";
import { GET as getMyReports } from "@/app/api/me/reports/route";
import { POST as postReveal } from "@/app/api/reveal/route";
import { RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { db } from "@/server/db";
import { meToos, reports } from "@/server/db/schema";
import { insertReport, insertResident } from "./reports";

// The route handlers for the feed, map, Me page and reveal (§5.1, §5.2, §5.4, §6.2):
// the glue between the Request and the server functions, which have their own tests.

const none = { params: Promise.resolve({}) };

async function call(handler: (req: Request, ctx: never) => Promise<Response>, url: string, init?: RequestInit, ctx: object = none) {
  const response = await handler(new Request(`https://govtok.test${url}`, init), ctx as never);
  return { status: response.status, body: await response.json(), headers: response.headers };
}

const asDevice = (token: string) => ({ headers: { [RESIDENT_TOKEN_HEADER]: token } });

describe("GET /api/feed and /api/feed/[id]", () => {
  it("serves the feed, never cached", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { title: "Open" });
    await insertReport(resident.id, { title: "Held", status: "held" });
    const { status, body, headers } = await call(getFeed, "/api/feed");
    expect(status).toBe(200);
    expect(body.map((r: { title: string }) => r.title)).toEqual(["Open"]);
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("serves a report by id, and null for a held one", async () => {
    const resident = await insertResident();
    const open = await insertReport(resident.id, { title: "Open" });
    const held = await insertReport(resident.id, { status: "held" });
    const byId = (id: string) => call(getFeedReport, `/api/feed/${id}`, undefined, { params: Promise.resolve({ id }) });
    expect((await byId(open.id)).body.title).toBe("Open");
    expect(await byId(held.id)).toMatchObject({ status: 200, body: null });
  });

  it("answers a junk id with null, not a 500", async () => {
    const byId = (id: string) => call(getFeedReport, `/api/feed/${id}`, undefined, { params: Promise.resolve({ id }) });
    expect(await byId("not-an-id")).toMatchObject({ status: 200, body: null });
  });
});

describe("GET /api/map", () => {
  it("serves the markers", async () => {
    const resident = await insertResident();
    const open = await insertReport(resident.id);
    await insertReport(resident.id, { status: "pending" });
    const { body } = await call(getMap, "/api/map");
    expect(body.map((r: { _id: string }) => r._id)).toEqual([open.id]);
  });
});

describe("GET /api/me/*", () => {
  it("returns the device's own posts and me-toos", async () => {
    const me = await insertResident("device-a");
    const other = await insertResident("device-b");
    await insertReport(me.id, { title: "Mine", status: "held", verdict: "retake" });
    const theirs = await insertReport(other.id, { title: "Theirs" });
    await db.insert(meToos).values({ reportId: theirs.id, residentId: me.id, createdAt: 2 });

    const mine = await call(getMyReports, "/api/me/reports", asDevice("device-a"));
    expect(mine.body.map((r: { title: string }) => r.title)).toEqual(["Mine"]);
    const followed = await call(getMeToos, "/api/me/me-toos", asDevice("device-a"));
    expect(followed.body.map((r: { report: { title: string } }) => r.report.title)).toEqual(["Theirs"]);
  });

  it("is empty for an unknown device or none, and never creates a resident", async () => {
    expect((await call(getMyReports, "/api/me/reports", asDevice("nobody"))).body).toEqual([]);
    expect((await call(getMeToos, "/api/me/me-toos")).body).toEqual([]);
    const { residents } = await import("@/server/db/schema");
    expect(await db.select().from(residents)).toEqual([]);
  });
});

describe("POST /api/reveal", () => {
  const post = (body: unknown) =>
    call(postReveal, "/api/reveal", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("counts a view on a fixed report", async () => {
    const resident = await insertResident();
    const fixed = await insertReport(resident.id, { status: "fixed", fixedAt: 3, fixedByKind: "fixer" });
    expect(await post({ reportId: fixed.id })).toMatchObject({ status: 200, body: null });
    expect((await db.select().from(reports).where(eq(reports.id, fixed.id)))[0].revealViews).toBe(1);
  });

  it("ignores a junk id or a missing one, and rejects a body that isn't JSON", async () => {
    expect((await post({ reportId: "nope" })).status).toBe(200);
    expect((await post({})).status).toBe(200);
    expect((await post(null)).status).toBe(200);
    expect((await post(7)).status).toBe(200);
    const bad = await call(postReveal, "/api/reveal", { method: "POST", body: "{" });
    expect(bad.status).toBe(400);
  });
});
