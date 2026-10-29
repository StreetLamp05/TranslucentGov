import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { reports } from "./db/schema";
import { UserError } from "./lib/errors";
import { validLocation } from "./lib/location";
import { boundingBox, haversineMeters, NEARBY_METERS } from "./lib/geo";
import { publicReport, reportDoc, type PublicReport } from "./lib/publicReport";
import { reportMedia } from "./reportMedia";

export type NearbySuggestion = {
  report: PublicReport;
  distanceMeters: number;
  isMine: boolean;
};

// The duplicate check (§4.1.2): up to 3 open reports within 50 m, nearest first. A bounding
// box narrows the query by latitude (indexed) and the longitude and distance are confirmed here.
export async function nearbyOpen(residentId: string | null, lat: number, lng: number): Promise<NearbySuggestion[]> {
  if (!validLocation(lat, lng)) throw new UserError("That location isn't valid.");
  const point = { lat, lng };
  const box = boundingBox(point, NEARBY_METERS);
  const rows = await db
    .select()
    .from(reports)
    .where(and(eq(reports.status, "open"), gte(reports.lat, box.minLat), lte(reports.lat, box.maxLat)));

  const nearby = rows
    .map((report) => ({ report, distanceMeters: haversineMeters(point, report) }))
    .filter(({ distanceMeters, report }) => {
      // Wrapped, so a box across the date line still finds its neighbors.
      const longitudeDelta = ((report.lng - lng + 540) % 360) - 180;
      return Math.abs(longitudeDelta) <= (box.maxLng - box.minLng) / 2 && distanceMeters <= NEARBY_METERS;
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 3);

  return Promise.all(
    nearby.map(async ({ report, distanceMeters }) => ({
      report: await publicReport(reportMedia, reportDoc(report)),
      distanceMeters,
      isMine: residentId !== null && report.residentId === residentId,
    })),
  );
}
