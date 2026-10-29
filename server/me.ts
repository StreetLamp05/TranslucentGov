import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { meToos, reports } from "./db/schema";
import { ownerReport, publicReportOrNull, reportDoc, type OwnerReport, type PublicReport } from "./lib/publicReport";
import { reportMedia } from "./reportMedia";

// The private Me page (§5.4.1): keyed by the device's resident, so a caller only ever reads
// their own posts and me-toos. A device with no resident yet (null) has neither.

// Newest post first. Not lastActivityAt, which every me-too bumps.
export async function myReports(residentId: string | null): Promise<OwnerReport[]> {
  if (!residentId) return [];
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.residentId, residentId))
    .orderBy(desc(reports.createdAt), desc(reports.creationTime));
  return Promise.all(rows.map((row) => ownerReport(reportMedia, reportDoc(row), residentId)));
}

// Reports you me-too'd, newest me-too first. One that is no longer public drops out.
export async function myMeToos(residentId: string | null): Promise<{ createdAt: number; report: PublicReport }[]> {
  if (!residentId) return [];
  const rows = await db
    .select({ createdAt: meToos.createdAt, report: reports })
    .from(meToos)
    .innerJoin(reports, eq(reports.id, meToos.reportId))
    .where(eq(meToos.residentId, residentId))
    .orderBy(desc(meToos.createdAt), desc(meToos.creationTime));
  const followed = await Promise.all(
    rows.map(async ({ createdAt, report }) => ({
      createdAt,
      report: await publicReportOrNull(reportMedia, reportDoc(report)),
    })),
  );
  const publicFollowed: { createdAt: number; report: PublicReport }[] = [];
  for (const entry of followed) {
    if (entry.report) publicFollowed.push({ createdAt: entry.createdAt, report: entry.report });
  }
  return publicFollowed;
}
