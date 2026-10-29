import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";

// Views per fix reveal (§6.2.1): +1 when a card's FIXED stamp first plays. The client calls it
// once per report per session (recordRevealViewOnce in components/RevealPlayer.tsx), not on
// every loop. No-op unless the report is fixed, or the id is junk. It doesn't bump
// lastActivityAt, so a reveal being watched never reorders the feed (§5.1.2). No token: anyone
// could inflate it, which is acceptable for a demo counter. One UPDATE, so concurrent views
// don't lose a count.
export async function recordRevealView(reportId: string | null): Promise<void> {
  if (reportId === null) return;
  await db
    .update(reports)
    .set({ revealViews: sql`${reports.revealViews} + 1` })
    .where(and(eq(reports.id, reportId), eq(reports.status, "fixed")));
}
