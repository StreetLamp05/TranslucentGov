import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { meToos, reports } from "./db/schema";
import { UserError } from "./lib/errors";

// "Me too" on an open report (§4.1.2). Your own report and a repeat tap do nothing. The report
// row is locked first, so two taps at once can't both count, and the unique index is the backstop.
export async function meToo(residentId: string, reportId: string | null): Promise<{ added: boolean }> {
  if (!reportId) throw new UserError("Report not found");
  return db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
    if (!report) throw new UserError("Report not found");
    if (report.status !== "open") throw new UserError("You can only me-too an open report");
    if (report.residentId === residentId) return { added: false };

    const now = Math.max(Date.now(), report.lastActivityAt + 1);
    const inserted = await tx
      .insert(meToos)
      .values({ reportId, residentId, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: meToos.id });
    if (inserted.length === 0) return { added: false };

    await tx
      .update(reports)
      .set({ meTooCount: sql`${reports.meTooCount} + 1`, lastActivityAt: now })
      .where(eq(reports.id, reportId));
    return { added: true };
  });
}
