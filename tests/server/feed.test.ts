import { describe, expect, it } from "vitest";
import { FEED_SIZE, feed, reportById } from "@/server/feed";
import { insertReport, insertResident } from "./reports";

// One report per status, with lastActivityAt deliberately out of insertion order.
async function seed() {
  const resident = await insertResident("poster");
  const ids = {
    open: (await insertReport(resident.id, { title: "Open", lastActivityAt: 20 })).id,
    pending: (await insertReport(resident.id, { title: "Pending", status: "pending", lastActivityAt: 50 })).id,
    fixed: (await insertReport(resident.id, { title: "Fixed", status: "fixed", fixedAt: 30, lastActivityAt: 40 })).id,
    held: (await insertReport(resident.id, { title: "Held", status: "held", verdict: "retake", lastActivityAt: 60 })).id,
    muted: (await insertReport(resident.id, { title: "Muted", audioMuted: true, verdict: "mute", lastActivityAt: 10 })).id,
    older: (await insertReport(resident.id, { title: "Older", lastActivityAt: 30 })).id,
  };
  return { residentId: resident.id, ids };
}

describe("feed", () => {
  it("excludes pending and held reports and orders by lastActivityAt descending", async () => {
    await seed();
    const items = await feed();
    expect(items.map((r) => r.title)).toEqual(["Fixed", "Older", "Open", "Muted"]);
    expect(items.every((r) => r.status === "open" || r.status === "fixed")).toBe(true);
  });

  it("breaks a lastActivityAt tie with the newest row first", async () => {
    const resident = await insertResident();
    await insertReport(resident.id, { title: "First", lastActivityAt: 5 });
    await insertReport(resident.id, { title: "Second", lastActivityAt: 5 });
    expect((await feed()).map((r) => r.title)).toEqual(["Second", "First"]);
  });

  it("no item carries residentId or any private field", async () => {
    const { residentId } = await seed();
    const items = await feed();
    for (const item of items) {
      for (const field of ["residentId", "verdict", "reason", "clipStorageId", "frameStorageIds", "fixedBy"]) {
        expect(item).not.toHaveProperty(field);
      }
    }
    expect(JSON.stringify(items)).not.toContain(residentId);
  });

  it("serves presigned MinIO URLs for the clip and frames", async () => {
    await seed();
    const [item] = await feed();
    expect(new URL(item.clipUrl!).pathname).toBe("/govtok/clip-key");
    expect(item.clipUrl).toContain("X-Amz-Signature=");
    expect(item.frameUrls.map((url) => new URL(url!).pathname)).toEqual(["/govtok/frame-key"]);
  });

  it("a muted report has no transcript, captions or description", async () => {
    await seed();
    const muted = (await feed()).find((r) => r.title === "Muted")!;
    expect(muted.audioMuted).toBe(true);
    expect(muted).not.toHaveProperty("transcript");
    expect(muted).not.toHaveProperty("segments");
    expect(muted).not.toHaveProperty("description");
    expect(muted.clipUrl).toBeTruthy();
  });

  it("returns at most 50 public reports, the most recent ones, even with newer held and pending ones", async () => {
    const resident = await insertResident();
    for (let i = 1; i <= 55; i++) await insertReport(resident.id, { title: `#${i}`, lastActivityAt: i });
    // Newer but not public: they must not use up any of the 50.
    for (let i = 1; i <= 10; i++) {
      await insertReport(resident.id, { status: i % 2 ? "held" : "pending", lastActivityAt: 100 + i });
    }
    const items = await feed();
    expect(FEED_SIZE).toBe(50);
    expect(items).toHaveLength(50);
    expect(items[0].title).toBe("#55");
    expect(items[49].title).toBe("#6");
  });

  it("picks up a report the moment it turns public", async () => {
    const resident = await insertResident();
    const held = await insertReport(resident.id, { title: "Checking", status: "pending" });
    expect(await feed()).toEqual([]);
    const { db } = await import("@/server/db");
    const { reports } = await import("@/server/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(reports).set({ status: "open" }).where(eq(reports.id, held.id));
    expect((await feed()).map((r) => r.title)).toEqual(["Checking"]);
  });
});

describe("reportById", () => {
  it("returns open and fixed reports through the public projection", async () => {
    const { ids } = await seed();
    const open = await reportById(ids.open);
    expect(open?.title).toBe("Open");
    expect(open?._id).toBe(ids.open);
    expect(open).not.toHaveProperty("residentId");
    expect((await reportById(ids.fixed))?.title).toBe("Fixed");
  });

  it("returns null for a held or pending report", async () => {
    const { ids } = await seed();
    expect(await reportById(ids.held)).toBeNull();
    expect(await reportById(ids.pending)).toBeNull();
  });

  it("returns null for an unknown id, another table's id, or none", async () => {
    const { residentId } = await seed();
    expect(await reportById(crypto.randomUUID())).toBeNull();
    expect(await reportById(residentId)).toBeNull();
    expect(await reportById(null)).toBeNull();
  });
});
