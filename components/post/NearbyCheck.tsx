"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, mutate } from "@/lib/data/api";
import type { NearbySuggestion } from "@/server/nearby";
import { daysLabel, daysOpen } from "@/lib/days";

export type NearbyReport = NearbySuggestion;

export default function NearbyCheck({
  reports,
  now,
  onContinue,
}: {
  reports: NearbyReport[];
  now: number;
  onContinue: () => void;
}) {
  const router = useRouter();
  const [pendingReportId, setPendingReportId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addMeToo(reportId: string) {
    if (pendingReportId) return;
    setPendingReportId(reportId);
    setError(null);
    try {
      await mutate("/api/me-too", { reportId });
      router.push(`/?report=${reportId}`);
    } catch (err) {
      setError(err instanceof ApiError && typeof err.data === "string" ? err.data : "Couldn't add your me-too. Try again.");
    } finally {
      setPendingReportId(null);
    }
  }

  return (
    <main className="flex flex-col gap-4 p-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.035em]">Is it one of these?</h1>
        <p className="mt-1 text-sm text-[#68756F]">There are open reports within 50 m of your location.</p>
      </div>
      <ul className="flex flex-col gap-3">
        {reports.map(({ report, distanceMeters, isMine }) => (
          <li key={report._id} className="flex items-center gap-3 rounded-[18px] border border-[#E7E6DE] bg-[#FFFEFA] p-3">
            <Thumbnail url={report.frameUrls[0] ?? null} title={report.title ?? "Nearby report"} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{report.title ?? "Untitled report"}</p>
              {report.street && <p className="truncate text-xs text-[#68756F]">{report.street}</p>}
              <p className="mt-1 text-xs text-[#68756F]">
                {daysLabel(daysOpen(report.createdAt, now))} open · {Math.round(distanceMeters)} m away
              </p>
            </div>
            {isMine ? (
              <span className="shrink-0 text-xs font-semibold text-[#68756F]">Your report</span>
            ) : (
              <button
                type="button"
                onClick={() => void addMeToo(report._id)}
                disabled={pendingReportId !== null}
                className="shrink-0 rounded-xl bg-[#173F35] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#245446] disabled:opacity-50"
              >
                {pendingReportId === report._id ? "Adding…" : "Me too"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-[#8A1C1C]">{error}</p>}
      <button
        type="button"
        onClick={onContinue}
        className="rounded-xl border border-[#D8DDD2] bg-[#FFFEFA] px-4 py-3 font-semibold text-[#18382F]"
      >
        No, it&apos;s new
      </button>
    </main>
  );
}

function Thumbnail({ url, title }: { url: string | null; title: string }) {
  if (!url) return <div aria-hidden="true" className="size-16 shrink-0 rounded-xl bg-[#E7E9E0]" />;
  // MinIO URLs are not configured for next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" title={title} className="size-16 shrink-0 rounded-lg object-cover" />;
}
