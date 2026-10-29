import { and, eq, getTableName, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CATEGORIES, OWNERS } from "@/convex/lib/routing";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { meToos, reports, residents } from "@/server/db/schema";

const PORTED_TABLES = [
  "reports",
  "meToos",
  "residents",
  "fixers",
  "fixAttempts",
  "videoIntake",
  "videoIntakeAdminSessions",
] as const;
// New in Postgres: who uploaded each MinIO object (§8).
const NEW_TABLES = ["uploads"] as const;

async function newResident(token = "resident-token") {
  const [row] = await db.insert(residents).values({ token, createdAt: Date.now() }).returning();
  return row;
}

function reportRow(residentId: string) {
  return {
    residentId,
    mediaType: "video" as const,
    frameStorageIds: ["frame-1", "frame-2"],
    lat: 33.8121,
    lng: -84.5605,
    status: "pending" as const,
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 1_000,
    revealViews: 0,
    createdAt: 1_000,
  };
}

describe("server/db/schema on PGlite", () => {
  it("creates all 7 Convex tables and uploads through the migrations", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const created = result.rows.map((row) => row.table_name).sort();
    const expected = [...PORTED_TABLES, ...NEW_TABLES].map((name) => getTableName(schema[name])).sort();
    expect(created).toEqual(expected);
  });

  it("round-trips a report with its arrays, JSON segments and millisecond times", async () => {
    const resident = await newResident();
    const segments = [{ start: 0, end: 1.5, text: "this has been here since June" }];
    const [inserted] = await db
      .insert(reports)
      .values({ ...reportRow(resident.id), segments, createdAt: 1_761_000_000_000 })
      .returning();

    const [read] = await db.select().from(reports).where(eq(reports.id, inserted.id));
    expect(read.frameStorageIds).toEqual(["frame-1", "frame-2"]);
    expect(read.segments).toEqual(segments);
    expect(read.createdAt).toBe(1_761_000_000_000);
    expect(read.creationTime).toBeGreaterThan(0);
    expect(read.category).toBeNull();
  });

  it("gives rows inserted in one transaction increasing creation times, like Convex's _creationTime", async () => {
    const rows = await db.transaction(async (tx) => {
      const inserted = [];
      for (const token of ["a", "b", "c"]) {
        await tx.execute(sql`SELECT pg_sleep(0.002)`);
        inserted.push((await tx.insert(residents).values({ token, createdAt: 0 }).returning())[0]);
      }
      return inserted;
    });
    const times = rows.map((row) => row.creationTime);
    expect(new Set(times).size).toBe(3);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("starts every test with empty tables", async () => {
    expect(await db.select().from(residents)).toEqual([]);
  });

  it("allows one me-too per resident per report, as Convex's .unique() lookup assumes", async () => {
    const resident = await newResident();
    const [report] = await db.insert(reports).values(reportRow(resident.id)).returning();
    const row = { reportId: report.id, residentId: resident.id, createdAt: Date.now() };

    await db.insert(meToos).values(row);
    await expect(db.insert(meToos).values(row)).rejects.toThrow();
    const rows = await db
      .select()
      .from(meToos)
      .where(and(eq(meToos.reportId, report.id), eq(meToos.residentId, resident.id)));
    expect(rows).toHaveLength(1);
  });

  it("rejects a resident token that is already taken", async () => {
    await newResident("same");
    await expect(newResident("same")).rejects.toThrow();
  });

  it("keeps the category and owner enums in step with the routing table", () => {
    expect(schema.categoryEnum.enumValues).toEqual([...CATEGORIES]);
    expect(schema.ownerEnum.enumValues).toEqual([...OWNERS]);
  });
});
