import { describe, expect, it } from "vitest";
import { GET as nearbyRoute } from "@/app/api/nearby/route";
import { api, insertReport } from "./api";
import { upload } from "./api";

const CENTER = { lat: 33.8187, lng: -84.5824 };
const METERS_PER_DEGREE_LAT = 111_195;
const north = (meters: number) => ({ lat: CENTER.lat + meters / METERS_PER_DEGREE_LAT, lng: CENTER.lng });

const nearby = (token: string | undefined, at: { lat: unknown; lng: unknown } = CENTER) =>
  api(nearbyRoute, { token, method: "GET", path: `/api/nearby?lat=${at.lat}&lng=${at.lng}` });

type Suggestion = { report: { _id: string; title?: string; frameUrls: string[] }; distanceMeters: number; isMine: boolean };

describe("GET /api/nearby (nearbyOpen)", () => {
  it("includes a report 40 m away, excludes one 60 m away and non-open reports", async () => {
    const near = await insertReport("poster", { title: "40 m away", ...north(40) });
    await insertReport("poster", { title: "60 m away", ...north(60) });
    await insertReport("poster", { title: "Fixed", status: "fixed", ...north(10) });
    await insertReport("poster", { title: "Held", status: "held", ...north(20) });

    const { status, body } = await nearby("resident");
    const result = body as Suggestion[];
    expect(status).toBe(200);
    expect(result.map(({ report }) => report._id)).toEqual([near.id]);
    expect(result[0].distanceMeters).toBeCloseTo(40, 0);
  });

  it("returns only the three nearest reports, nearest first, and marks this resident's own", async () => {
    await insertReport("other", { title: "10 m", ...north(10) });
    await insertReport("owner", { title: "20 m", ...north(20) });
    await insertReport("other", { title: "30 m", ...north(30) });
    await insertReport("other", { title: "40 m", ...north(40) });

    const result = (await nearby("owner")).body as Suggestion[];
    expect(result.map(({ report }) => report.title)).toEqual(["10 m", "20 m", "30 m"]);
    expect(result.map(({ isMine }) => isMine)).toEqual([false, true, false]);
    expect(((await nearby(undefined)).body as Suggestion[]).some(({ isMine }) => isMine)).toBe(false);
  });

  it("returns presigned frame URLs and no private fields", async () => {
    const key = await upload("poster", "image/jpeg");
    await insertReport("poster", { title: "With a frame", frameStorageIds: [key], ...north(5) });
    const [{ report }] = (await nearby("resident")).body as Suggestion[];
    expect(report.frameUrls[0]).toContain(key);
    expect(report).not.toHaveProperty("residentId");
  });

  it("returns an empty list when nothing open is nearby", async () => {
    expect(await nearby("resident")).toEqual({ status: 200, body: [] });
  });

  it("finds nearby reports across the international date line", async () => {
    const west = await insertReport("poster", { title: "Across the line", lat: 0, lng: -179.99999 });
    const result = (await nearby("resident", { lat: 0, lng: 179.99999 })).body as Suggestion[];
    expect(result.map(({ report }) => report._id)).toEqual([west.id]);
  });

  it("rejects a location that isn't one, as a 400", async () => {
    for (const at of [{ lat: "x", lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: "", lng: 0 }]) {
      expect((await nearby("resident", at)).status).toBe(400);
    }
    expect((await api(nearbyRoute, { method: "GET", path: "/api/nearby" })).status).toBe(400);
  });
});
