import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { meToos } from "@/server/db/schema";
import { myMeToos, myReports } from "@/server/me";
import { insertReport, insertResident } from "./reports";

describe("myReports", () => {
  it("returns all statuses, only for the resident asking", async () => {
    const own = await insertResident("resident-a");
    const other = await insertResident("resident-b");
    const ownRows = [
      await insertReport(own.id, { title: "Pending", status: "pending", createdAt: 1, lastActivityAt: 1 }),
      await insertReport(own.id, { title: "Held", status: "held", verdict: "retake", reason: "Cover the plate", createdAt: 2, lastActivityAt: 2 }),
      await insertReport(own.id, { title: "Open", createdAt: 3, lastActivityAt: 3 }),
      await insertReport(own.id, { title: "Muted", audioMuted: true, transcript: "John at 412 Elm", description: "Ask John", createdAt: 4, lastActivityAt: 4 }),
      await insertReport(own.id, { title: "Fixed", status: "fixed", fixedAt: 5, createdAt: 5, lastActivityAt: 5 }),
    ];
    await insertReport(other.id, { title: "Other resident" });

    const mine = await myReports(own.id);
    expect(mine.map((r) => r.title)).toEqual(["Fixed", "Muted", "Open", "Held", "Pending"]);
    expect(mine.map((r) => r._id)).toEqual(ownRows.map((r) => r.id).reverse());
    expect(mine.every((r) => !("residentId" in r))).toBe(true);
    const muted = mine.find((r) => r.title === "Muted");
    expect(muted).not.toHaveProperty("transcript");
    expect(muted).not.toHaveProperty("description");
    expect(mine.find((r) => r.title === "Held")).toMatchObject({ verdict: "retake", reason: "Cover the plate" });
    expect((await myReports(other.id)).map((r) => r.title)).toEqual(["Other resident"]);
  });

  it("is empty for a device with no resident yet", async () => {
    expect(await myReports(null)).toEqual([]);
  });

  it("orders posts by when they were posted, not by me-too activity", async () => {
    const own = await insertResident();
    const neighbor = await insertResident();
    const older = await insertReport(own.id, { title: "Older", createdAt: 1, lastActivityAt: 1 });
    await insertReport(own.id, { title: "Newer", createdAt: 2, lastActivityAt: 2 });
    await db.insert(meToos).values({ reportId: older.id, residentId: neighbor.id, createdAt: 9 });
    expect((await myReports(own.id)).map((r) => r.title)).toEqual(["Newer", "Older"]);
  });
});

describe("myMeToos", () => {
  it("returns only public reports the caller me-too'd, newest first", async () => {
    const a = await insertResident("resident-a");
    const b = await insertResident("resident-b");
    const open = await insertReport(b.id, { title: "Open" });
    const fixed = await insertReport(b.id, { title: "Fixed", status: "fixed", fixedAt: 2 });
    const held = await insertReport(b.id, { title: "Held", status: "held", verdict: "reject" });
    const otherOpen = await insertReport(b.id, { title: "Other open" });
    await db.insert(meToos).values([
      { reportId: open.id, residentId: a.id, createdAt: 1 },
      { reportId: fixed.id, residentId: a.id, createdAt: 2 },
      { reportId: held.id, residentId: a.id, createdAt: 3 },
      { reportId: otherOpen.id, residentId: b.id, createdAt: 4 },
    ]);

    const followed = await myMeToos(a.id);
    expect(followed.map(({ report }) => report._id)).toEqual([fixed.id, open.id]);
    expect(followed.map(({ report }) => report.status)).toEqual(["fixed", "open"]);
    expect(followed.map(({ createdAt }) => createdAt)).toEqual([2, 1]);
    expect(followed.every(({ report }) => !("residentId" in report) && !("verdict" in report) && !("reason" in report))).toBe(true);
    expect((await myMeToos(b.id)).map(({ report }) => report._id)).toEqual([otherOpen.id]);
  });

  it("is empty for a device with no resident yet", async () => {
    expect(await myMeToos(null)).toEqual([]);
  });
});
