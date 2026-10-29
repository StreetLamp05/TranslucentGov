import { ConvexError, v } from "convex/values";
import { query } from "./_generated/server";
import { boundingBox, haversineMeters, NEARBY_METERS } from "../server/lib/geo";
import { findResident } from "./lib/auth";
import { publicReport, type PublicReport } from "./lib/publicReport";

export type NearbySuggestion = {
  report: PublicReport;
  distanceMeters: number;
  isMine: boolean;
};

export const nearbyOpen = query({
  args: { lat: v.number(), lng: v.number(), token: v.string() },
  handler: async (ctx, { lat, lng, token }): Promise<NearbySuggestion[]> => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ConvexError("That location isn't valid.");
    }
    const point = { lat, lng };
    const box = boundingBox(point, NEARBY_METERS);
    const residentId = await findResident(ctx, token);
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_status_lat", (q) => q.eq("status", "open").gte("lat", box.minLat).lte("lat", box.maxLat))
      .collect();

    const nearby = reports
      .map((report) => ({ report, distanceMeters: haversineMeters(point, report) }))
      .filter(({ distanceMeters, report }) => {
        const longitudeDelta = ((report.lng - lng + 540) % 360) - 180;
        const longitudeInBox = Math.abs(longitudeDelta) <= (box.maxLng - box.minLng) / 2;
        return longitudeInBox && distanceMeters <= NEARBY_METERS;
      })
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 3);

    return await Promise.all(
      nearby.map(async ({ report, distanceMeters }) => ({
        report: await publicReport(ctx, report),
        distanceMeters,
        isMine: residentId !== null && report.residentId === residentId,
      })),
    );
  },
});
