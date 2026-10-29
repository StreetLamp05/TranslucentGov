"use client";

import Link from "next/link";
import { useState } from "react";
import { haversineMeters, type Point } from "../../server/lib/geo";
import type { PublicReport } from "../../server/lib/publicReport";
import { OWNER_CHIP } from "../../server/lib/routing";
import { daysLabel, daysOpen } from "../../lib/days";
import { useCurrentLocation } from "../../lib/hooks/useCurrentLocation";

// The fixer's list of open reports, nearest first (§5.3.1). Distance is measured from
// useCurrentLocation, which is DEMO_POINT in demo mode (§6.1.1).

export type RankedReport = { report: PublicReport; meters: number };

// Nearest first. Ties keep their incoming order.
export function sortNearestFirst(reports: readonly PublicReport[], from: Point): RankedReport[] {
  return reports
    .map((report) => ({ report, meters: haversineMeters(from, report) }))
    .sort((a, b) => a.meters - b.meters);
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function OwnerChip({ report }: { report: PublicReport }) {
  const chip = OWNER_CHIP[report.owner ?? "unknown"];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: chip.bg, color: chip.fg }}
    >
      <span className="size-2 rounded-full" style={{ background: chip.dot }} />
      {report.agency ?? chip.label}
    </span>
  );
}

export default function FixerList({ reports }: { reports: readonly PublicReport[] }) {
  const location = useCurrentLocation();
  const [now] = useState(() => Date.now());

  // Without a location fix, the longest-open reports come first and distance is hidden.
  const ranked: { report: PublicReport; meters: number | null }[] =
    location.status === "ready"
      ? sortNearestFirst(reports, location.point)
      : [...reports].sort((a, b) => a.createdAt - b.createdAt).map((report) => ({ report, meters: null }));

  return (
    <section>
      <LocationNote status={location.status} />
      {ranked.length === 0 ? (
        <p className="py-12 text-center text-sm text-[#46505C]">No open reports right now.</p>
      ) : (
        <ul className="divide-y divide-[#E2E6EA] overflow-hidden rounded-2xl bg-white">
          {ranked.map(({ report, meters }) => (
            <li key={report._id}>
              <Link href={`/fix/${report._id}`} className="flex gap-3 p-3 active:bg-[#F4F6F8]">
                <Thumbnail url={report.frameUrls[0] ?? null} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{report.title ?? "Untitled report"}</p>
                  {report.street && <p className="truncate text-xs text-[#46505C]">{report.street}</p>}
                  <div className="mt-1">
                    <OwnerChip report={report} />
                  </div>
                  <p className="mt-1 text-xs text-[#46505C]">
                    Open · {daysLabel(daysOpen(report.createdAt, now))} · {report.meTooCount} me too
                  </p>
                </div>
                {meters !== null && (
                  <p className="shrink-0 self-center text-sm font-bold" data-testid="distance">
                    {formatDistance(meters)}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Thumbnail({ url }: { url: string | null }) {
  if (!url) return <div className="size-16 shrink-0 rounded-lg bg-[#E2E6EA]" />;
  // MinIO URLs, so next/image's remote config doesn't apply.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="size-16 shrink-0 rounded-lg object-cover" />;
}

function LocationNote({ status }: { status: ReturnType<typeof useCurrentLocation>["status"] }) {
  if (status === "ready") return null;
  const text =
    status === "loading"
      ? "Finding your location…"
      : "Location isn't available, so the list isn't sorted by distance.";
  return <p className="mb-3 text-xs text-[#46505C]">{text}</p>;
}
