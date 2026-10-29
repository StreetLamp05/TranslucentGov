import { describe, expect, it } from "vitest";
import { mapReports, toMapReport } from "@/server/map";
import { insertReport, insertResident } from "./reports";

const MAP_FIELDS = ["_id", "category", "isSample", "lat", "lng", "meTooCount", "status", "title"];

describe("mapReports", () => {
  it("returns only open and fixed reports, with only the map's fields", async () => {
    const resident = await insertResident("poster");
    const open = await insertReport(resident.id, { title: "A open pothole", meTooCount: 2 });
    const fixed = await insertReport(resident.id, {
      title: "A fixed pothole",
      status: "fixed",
      meTooCount: 4,
      fixStorageId: "fix-key",
      fixedAt: 9,
      fixedByKind: "fixer",
      verdict: "pass",
      reason: "Nothing found",
    });
    await insertReport(resident.id, { status: "pending" });
    await insertReport(resident.id, { status: "held" });

    const reports = await mapReports();

    expect(reports.map((r) => r._id).sort()).toEqual([open.id, fixed.id].sort());
    for (const report of reports) expect(Object.keys(report).sort()).toEqual(MAP_FIELDS);
    expect(reports.find((r) => r._id === fixed.id)).toEqual({
      _id: fixed.id,
      lat: 33.8187,
      lng: -84.5824,
      status: "fixed",
      meTooCount: 4,
      title: "A fixed pothole",
      category: "pothole",
      isSample: false,
    });
  });

  it("leaves out a title or category the report doesn't have yet", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { title: null, category: null });
    const [report] = await mapReports();
    expect(Object.keys(report).sort()).toEqual(["_id", "isSample", "lat", "lng", "meTooCount", "status"]);
  });

  it("is empty when nothing is public", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { status: "held" });
    expect(await mapReports()).toEqual([]);
  });
});

describe("toMapReport", () => {
  const row = { id: "r", lat: 1, lng: 2, meTooCount: 0, title: null, category: null, isSample: false };

  it("refuses a pending or held report, so a read path without a status filter fails loudly", () => {
    expect(() => toMapReport({ ...row, status: "pending" })).toThrow(/is pending, not public/);
    expect(() => toMapReport({ ...row, status: "held" })).toThrow(/is held, not public/);
    expect(toMapReport({ ...row, status: "open" }).status).toBe("open");
  });
});
