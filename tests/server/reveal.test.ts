import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { reports } from "@/server/db/schema";
import { recordRevealView } from "@/server/reveal";
import { insertReport, insertResident } from "./reports";

const fixedReport = async (overrides: Partial<typeof reports.$inferInsert> = {}) =>
  insertReport((await insertResident()).id, {
    status: "fixed",
    fixedAt: 30,
    fixedByKind: "fixer",
    lastActivityAt: 40,
    ...overrides,
  });

const read = async (id: string) => (await db.select().from(reports).where(eq(reports.id, id)))[0];

describe("recordRevealView", () => {
  it("adds 1 per call and leaves lastActivityAt alone", async () => {
    const { id } = await fixedReport({ revealViews: 4 });

    await recordRevealView(id);
    expect((await read(id)).revealViews).toBe(5);

    await recordRevealView(id);
    const after = await read(id);
    expect(after.revealViews).toBe(6);
    expect(after.lastActivityAt).toBe(40);
  });

  it("doesn't lose views that arrive together", async () => {
    const { id } = await fixedReport();
    await Promise.all(Array.from({ length: 8 }, () => recordRevealView(id)));
    expect((await read(id)).revealViews).toBe(8);
  });

  it.each(["open", "pending", "held"] as const)("does nothing on a %s report", async (status) => {
    const { id } = await fixedReport({ status, fixedAt: null, fixedByKind: null });
    await recordRevealView(id);
    expect((await read(id)).revealViews).toBe(0);
  });

  it("does nothing for a missing report or a junk id", async () => {
    await expect(recordRevealView(crypto.randomUUID())).resolves.toBeUndefined();
    await expect(recordRevealView(null)).resolves.toBeUndefined();
  });
});
