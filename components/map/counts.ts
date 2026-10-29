import type { MapReport } from "../../server/map";

// Map numbers and colors (§5.2.1). A marker counts its poster plus every me-too, and a
// cluster sums its markers, so the number reads as "people reporting", not "pins".

export type MapStatus = MapReport["status"];

export const STATUS_COLOR: Record<MapStatus, string> = {
  open: "#C2410C",
  fixed: "#157A47",
};
// A cluster holding both open and fixed reports.
export const MIXED_COLOR = "#1E3A5F";

export function markerCount(report: Pick<MapReport, "meTooCount">): number {
  return 1 + report.meTooCount;
}

export function clusterCount(members: Pick<MapReport, "meTooCount">[]): number {
  return members.reduce((sum, report) => sum + markerCount(report), 0);
}

export function clusterColor(members: Pick<MapReport, "status">[]): string {
  const statuses = new Set(members.map((report) => report.status));
  return statuses.size === 1 ? STATUS_COLOR[members[0].status] : MIXED_COLOR;
}

// Bigger bubbles for more people, capped so a busy block doesn't cover the street.
export function bubbleSize(count: number): number {
  return Math.round(30 + Math.min(22, Math.sqrt(count) * 4));
}
