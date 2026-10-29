import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { fixers, reports, residents, type Report } from "@/server/db/schema";
import { ownerReport, publicReport, publicReportOrNull, reportDoc, UNKNOWN_FIXER_LABEL } from "@/server/lib/publicReport";
import { reportMedia } from "@/server/reportMedia";

// The public projection (§7.1.1) on Postgres rows. The Convex side runs the same code through
// convex/lib/publicReport.ts (tests/convex/lib/publicReport.test.ts).

async function insertReport(overrides: Partial<typeof reports.$inferInsert> = {}): Promise<Report> {
  const [resident] = await db.insert(residents).values({ token: crypto.randomUUID(), createdAt: 1 }).returning();
  const [row] = await db
    .insert(reports)
    .values({
      residentId: resident.id,
      mediaType: "video",
      description: "Cars swerve around it",
      clipStorageId: "clip-key",
      frameStorageIds: ["frame-1", "frame-2"],
      transcript: "this has been here since June",
      lat: 33.8,
      lng: -84.5,
      status: "open",
      verdict: "pass",
      reason: "clear pothole",
      audioMuted: false,
      isSample: false,
      meTooCount: 2,
      lastActivityAt: 10,
      revealViews: 0,
      createdAt: 5,
      ...overrides,
    })
    .returning();
  return row;
}

describe("reportDoc", () => {
  it("renames id and creationTime, and drops nulls the way absent Convex fields were", async () => {
    const row = await insertReport();
    const doc = reportDoc(row);

    expect(doc._id).toBe(row.id);
    expect(doc._creationTime).toBe(row.creationTime);
    expect(doc).not.toHaveProperty("id");
    expect(doc).not.toHaveProperty("street"); // null in the row
    expect(doc).not.toHaveProperty("fixStorageId");
    expect(doc.frameStorageIds).toEqual(["frame-1", "frame-2"]);
  });
});

describe("publicReport on Postgres", () => {
  it("presigns media URLs and never returns private fields", async () => {
    const row = await insertReport();
    const pub = await publicReport(reportMedia, reportDoc(row));

    expect(new URL(pub.clipUrl!).pathname).toBe("/govtok/clip-key");
    expect(pub.frameUrls.map((url) => new URL(url!).pathname)).toEqual(["/govtok/frame-1", "/govtok/frame-2"]);
    expect(pub.fixUrl).toBeNull();
    expect(pub).not.toHaveProperty("residentId");
    expect(pub).not.toHaveProperty("verdict");
    expect(pub).not.toHaveProperty("reason");
    expect(pub.description).toBe("Cars swerve around it");
  });

  it("drops what was said or written on a muted report", async () => {
    const pub = await publicReport(reportMedia, reportDoc(await insertReport({ audioMuted: true })));
    expect(pub).not.toHaveProperty("description");
    expect(pub).not.toHaveProperty("transcript");
  });

  it("refuses pending and held reports", async () => {
    const held = reportDoc(await insertReport({ status: "held" }));
    await expect(publicReport(reportMedia, held)).rejects.toThrow(/not public/);
    expect(await publicReportOrNull(reportMedia, held)).toBeNull();
  });

  it("labels a fixer's fix with the fixer's org, looked up when not stored", async () => {
    const [fixer] = await db.insert(fixers).values({ name: "Dana", org: "Cobb DOT", passcode: "1" }).returning();
    const base = { status: "fixed" as const, fixedByKind: "fixer" as const, fixedAt: 20, fixStorageId: "fix-key" };

    const looked = await publicReport(reportMedia, reportDoc(await insertReport({ ...base, fixedBy: fixer.id })));
    expect(looked.fixedByLabel).toBe("Cobb DOT");
    expect(looked).not.toHaveProperty("fixedBy");

    const gone = await publicReport(
      reportMedia,
      reportDoc(await insertReport({ ...base, fixedBy: "00000000-0000-4000-8000-000000000009" })),
    );
    expect(gone.fixedByLabel).toBe(UNKNOWN_FIXER_LABEL);
  });

  it("ownerReport adds the verdict for the poster only", async () => {
    const row = await insertReport({ status: "held", verdict: "retake" });
    const own = await ownerReport(reportMedia, reportDoc(row), row.residentId);
    expect(own.verdict).toBe("retake");
    expect(own.reason).toBe("clear pothole");

    await expect(ownerReport(reportMedia, reportDoc(row), "someone-else")).rejects.toThrow(/isn't this resident's/);
  });
});
