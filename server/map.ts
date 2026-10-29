import { inArray } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";
import { isPublicStatus, PUBLIC_STATUSES, type PublicReport, type ReportStatus } from "./lib/publicReport";

// The map's live query (§5.2.1). Only the fields a marker needs, so the map doesn't pay for a
// presigned URL on every report. Like publicReport it's an allowlist: a field added to
// `reports` never shows up here by accident. isSample labels seeded reports on the map too,
// since everything simulated is labeled (§6.1.1).
export type MapReport = Pick<
  PublicReport,
  "_id" | "lat" | "lng" | "status" | "meTooCount" | "title" | "category" | "isSample"
>;

type MapRow = {
  id: string;
  lat: number;
  lng: number;
  status: ReportStatus;
  meTooCount: number;
  title: string | null;
  category: PublicReport["category"] | null;
  isSample: boolean;
};

// Throws on a pending or held report, like publicReport, so a future read path that forgets
// its status filter fails loudly instead of putting a held report on the map. Absent fields are
// left out, as M0's were.
export function toMapReport(row: MapRow): MapReport {
  const { status } = row;
  if (!isPublicStatus(status)) {
    throw new Error(`toMapReport: report ${row.id} is ${status}, not public`);
  }
  return {
    _id: row.id,
    lat: row.lat,
    lng: row.lng,
    status,
    meTooCount: row.meTooCount,
    ...(row.title !== null && { title: row.title }),
    ...(row.category !== null && { category: row.category }),
    isSample: row.isSample,
  };
}

// Open and fixed reports only (§2.1.3). No bounding box yet: all of Mableton fits in one
// query at pilot scale (§1.1.1).
export async function mapReports(): Promise<MapReport[]> {
  const rows = await db
    .select({
      id: reports.id,
      lat: reports.lat,
      lng: reports.lng,
      status: reports.status,
      meTooCount: reports.meTooCount,
      title: reports.title,
      category: reports.category,
      isSample: reports.isSample,
    })
    .from(reports)
    .where(inArray(reports.status, [...PUBLIC_STATUSES]));
  return rows.map(toMapReport);
}
