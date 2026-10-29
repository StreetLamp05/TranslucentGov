import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_SESSION_HEADER, FIXER_TOKEN_HEADER, RESIDENT_TOKEN_HEADER } from "@/lib/data/headers";
import { db } from "@/server/db";
import { fixers, residents, videoIntakeAdminSessions } from "@/server/db/schema";
import { withArgs } from "@/lib/data/api";
import { callerFrom, isUuid, parseId, readJson, route, searchArgs } from "@/server/http";
import { UserError } from "@/server/lib/errors";

// The route-handler wrapper (§1.1.1) on PGlite: identity resolves the way M0's
// convex/lib/auth.ts and requireAdminSession did (§3.1), and errors map to JSON with a status.

function request(headers: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request("https://govtok.test/api/x", { ...init, headers });
}

const noParams = { params: Promise.resolve({}) };

async function call(handler: Parameters<typeof route>[0], req = request()) {
  const response = await route(handler)(req, noParams);
  return { status: response.status, body: await response.json(), response };
}

const residentCount = async () => (await db.select().from(residents)).length;

describe("caller.resident (writes)", () => {
  it("creates the resident on first use and returns the same one after", async () => {
    const caller = callerFrom(request({ [RESIDENT_TOKEN_HEADER]: "device-1" }));
    const id = await caller.resident();
    expect(await residentCount()).toBe(1);

    const again = await callerFrom(request({ [RESIDENT_TOKEN_HEADER]: " device-1 " })).resident();
    expect(again).toBe(id);
    expect(await residentCount()).toBe(1);
  });

  it("two first requests from one device at once make one resident", async () => {
    const headers = { [RESIDENT_TOKEN_HEADER]: "device-race" };
    const [a, b] = await Promise.all([callerFrom(request(headers)).resident(), callerFrom(request(headers)).resident()]);
    expect(a).toBe(b);
    expect(await residentCount()).toBe(1);
  });

  it("is a 401 without a device token", async () => {
    const { status, body } = await call(async (_req, { caller }) => caller.resident(), request());
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Missing device token" });
    expect(await residentCount()).toBe(0);
  });
});

describe("caller.findResident (reads)", () => {
  it("finds a known device and never creates one", async () => {
    expect(await callerFrom(request({ [RESIDENT_TOKEN_HEADER]: "new-device" })).findResident()).toBeNull();
    expect(await callerFrom(request()).findResident()).toBeNull();
    expect(await residentCount()).toBe(0);

    const id = await callerFrom(request({ [RESIDENT_TOKEN_HEADER]: "known" })).resident();
    expect(await callerFrom(request({ [RESIDENT_TOKEN_HEADER]: "known" })).findResident()).toBe(id);
  });
});

describe("caller.fixer", () => {
  it("returns the fixer for a valid token", async () => {
    await db.insert(fixers).values({ name: "Dana", org: "Mableton Sanitation", passcode: "4821", token: "fx-1" });
    const fixer = await callerFrom(request({ [FIXER_TOKEN_HEADER]: "fx-1" })).fixer();
    expect(fixer.org).toBe("Mableton Sanitation");
  });

  it("is a 401 for a missing or unknown token, with M0's messages", async () => {
    const missing = await call(async (_req, { caller }) => caller.fixer(), request());
    expect(missing).toMatchObject({ status: 401, body: { error: "Missing fixer token" } });

    const unknown = await call(async (_req, { caller }) => caller.fixer(), request({ [FIXER_TOKEN_HEADER]: "nope" }));
    expect(unknown).toMatchObject({ status: 401, body: { error: "Invalid fixer token" } });
  });

  it("doesn't take a resident token as a fixer token", async () => {
    await db.insert(fixers).values({ name: "Dana", org: "Mableton Sanitation", passcode: "4821", token: "shared" });
    const { status } = await call(async (_req, { caller }) => caller.fixer(), request({ [RESIDENT_TOKEN_HEADER]: "shared" }));
    expect(status).toBe(401);
  });
});

describe("caller.requireAdmin", () => {
  it("accepts an unexpired session and refuses a missing, unknown or expired one", async () => {
    await db.insert(videoIntakeAdminSessions).values([
      { token: "live", expiresAt: Date.now() + 60_000 },
      { token: "stale", expiresAt: Date.now() - 1 },
    ]);
    const admin = (headers: Record<string, string>) =>
      call(async (_req, { caller }) => {
        await caller.requireAdmin();
        return "ok";
      }, request(headers));

    expect(await admin({ [ADMIN_SESSION_HEADER]: "live" })).toMatchObject({ status: 200, body: "ok" });
    expect(await admin({})).toMatchObject({ status: 401, body: { error: "Admin login required." } });
    expect(await admin({ [ADMIN_SESSION_HEADER]: "unknown" })).toMatchObject({
      status: 401,
      body: { error: "Admin session expired. Sign in again." },
    });
    expect(await admin({ [ADMIN_SESSION_HEADER]: "stale" })).toMatchObject({ status: 401 });
  });
});

describe("route", () => {
  it("sends the handler's result as uncached JSON, and undefined as null", async () => {
    const ok = await call(async () => ({ reportId: "r1" }));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ reportId: "r1" });
    expect(ok.response.headers.get("cache-control")).toBe("no-store");

    expect((await call(async () => undefined)).body).toBeNull();
  });

  it("passes a Response through untouched", async () => {
    const response = await route(async () => new Response("hi", { status: 201 }))(request(), noParams);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("hi");
  });

  it("hands the handler its dynamic segments", async () => {
    const handler = route<{ reportId: string }>(async (_req, { params }) => params.reportId);
    const response = await handler(request(), { params: Promise.resolve({ reportId: "r42" }) });
    expect(await response.json()).toBe("r42");
  });

  it("maps a UserError to its status and message", async () => {
    const { status, body } = await call(async () => {
      throw new UserError("Report not found", 404);
    });
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Report not found" });
  });

  it("hides any other error behind a bare 500 and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await call(async () => {
      throw new Error('duplicate key value violates unique constraint "residents_by_token"');
    });
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Server Error" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("lets Next's redirect() through instead of turning it into a 500", async () => {
    const { redirect } = await import("next/navigation");
    const handler = route(async () => redirect("/fix"));
    await expect(handler(request(), noParams)).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
  });

  it("resolves identity only when the handler asks, so a read never creates a resident", async () => {
    await call(async () => "no identity needed", request({ [RESIDENT_TOKEN_HEADER]: "device-2" }));
    expect(await residentCount()).toBe(0);
  });

  it("reads a JSON body, and a malformed one is a 400", async () => {
    const echo = async (req: Request) => readJson(req);
    const good = await call(echo, request({ "content-type": "application/json" }, { method: "POST", body: '{"a":1}' }));
    expect(good.body).toEqual({ a: 1 });

    const bad = await call(echo, request({}, { method: "POST", body: "{nope" }));
    expect(bad).toMatchObject({ status: 400, body: { error: "The request body isn't valid JSON." } });
  });

  it("looks each identity up once per request", async () => {
    const { body } = await call(async (_req, { caller }) => {
      const [a, b] = await Promise.all([caller.resident(), caller.resident()]);
      return a === b;
    }, request({ [RESIDENT_TOKEN_HEADER]: "device-3" }));
    expect(body).toBe(true);
    const [row] = await db.select().from(residents).where(eq(residents.token, "device-3"));
    expect(row).toBeDefined();
  });
});

describe("parseId", () => {
  it("passes a UUID through and turns anything else into null instead of a Postgres error", async () => {
    const [row] = await db.insert(residents).values({ token: "t", createdAt: 1 }).returning();
    expect(isUuid(row.id)).toBe(true);
    expect(parseId(row.id)).toBe(row.id);
    expect(parseId(row.id.toUpperCase())).toBe(row.id.toUpperCase());

    for (const bad of ["garbage", "", "1234", `${row.id}x`, null, undefined, 42, ["a"]]) {
      expect(parseId(bad)).toBeNull();
    }
  });

  it("is what keeps a junk id a clean miss: Postgres itself rejects one", async () => {
    await expect(db.select().from(residents).where(eq(residents.id, "garbage"))).rejects.toThrow();
  });
});

describe("searchArgs", () => {
  // Built with the client's own encoder, so the two sides agree.
  const args = (query: Parameters<typeof withArgs>[1]) =>
    searchArgs(new Request(`https://govtok.test${withArgs("/api/x", query)}`));

  it("reads strings, whole numbers and repeated keys as query() sends them", () => {
    const a = args({ reportId: "r1", limit: 20, reportIds: ["a", "b"], skip: undefined });
    expect(a.string("reportId")).toBe("r1");
    expect(a.int("limit")).toBe(20);
    expect(a.list("reportIds")).toEqual(["a", "b"]);
    expect(a.list("none")).toEqual([]);
    expect(a.optionalString("skip")).toBeUndefined();
  });

  it("a missing or malformed required value is a 400 with a user-facing message", async () => {
    const a = args({ limit: "ten", lat: 1.5 });
    expect(() => a.string("reportId")).toThrow(new UserError("Missing reportId."));
    expect(() => a.int("limit")).toThrow(new UserError("limit must be a whole number."));
    expect(() => a.int("lat")).toThrow("lat must be a whole number.");

    const { status, body } = await call(async (req) => searchArgs(req).int("limit"), request());
    expect(status).toBe(400);
    expect(body).toEqual({ error: "Missing limit." });
  });
});
