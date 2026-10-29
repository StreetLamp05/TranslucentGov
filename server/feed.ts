import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";
import { PUBLIC_STATUSES, publicReport, publicReportOrNull, reportDoc, type PublicReport } from "./lib/publicReport";
import { reportMedia } from "./reportMedia";

// No pagination at hackathon scale (§5.1.2).
export const FEED_SIZE = 50;

// The feed (§5.1.2): open and fixed reports only, most recent activity first, through the
// public projection (§7.1.1). The client snapshots the order when the feed mounts. Ties fall
// back to the newest row, as M0's index did.
export async function feed(): Promise<PublicReport[]> {
  const rows = await db
    .select()
    .from(reports)
    .where(inArray(reports.status, [...PUBLIC_STATUSES]))
    .orderBy(desc(reports.lastActivityAt), desc(reports.creationTime))
    .limit(FEED_SIZE);
  return Promise.all(rows.map((row) => publicReport(reportMedia, reportDoc(row))));
}

// Deep links (`/?report=<id>`): null unless the report is open or fixed. The id comes from the
// URL, so a malformed one is null instead of reaching Postgres, which would reject it.
export async function reportById(id: string | null): Promise<PublicReport | null> {
  if (id === null) return null;
  const [row] = await db.select().from(reports).where(eq(reports.id, id));
  return publicReportOrNull(reportMedia, row ? reportDoc(row) : null);
}
