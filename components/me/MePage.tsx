"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OwnerReport, PublicReport } from "@/server/lib/publicReport";
import { query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { useResidentToken } from "@/lib/hooks/useResidentToken";
import { useT } from "@/lib/i18n/I18nProvider";
import LanguageSelector from "@/lib/i18n/LanguageSelector";
import MeReportCard from "./MeReportCard";

type FollowedReport = { createdAt: number; report: PublicReport };

export default function MePageContent() {
  const t = useT();
  const router = useRouter();
  const token = useResidentToken();
  // The device token goes out as a header (lib/data/api.ts); it's in the key so a token that
  // loads late (or changes) refetches.
  const reports = useLive(token ? `me:reports:${token}` : null, (signal) =>
    query<OwnerReport[]>("/api/me/reports", {}, { signal }),
  );
  const meToos = useLive(token ? `me:me-toos:${token}` : null, (signal) =>
    query<FollowedReport[]>("/api/me/me-toos", {}, { signal }),
  );
  const [now] = useState(() => Date.now());
  const resolved = [...(reports ?? []), ...(meToos ?? []).map(({ report }) => report)].filter(
    (report) => report.status === "fixed",
  ).length;

  return (
    <main className="min-h-dvh bg-[#F4F1E8] pb-24">
      <header className="relative overflow-hidden rounded-b-[30px] bg-[#173F35] px-6 pb-8 pt-9 text-center text-white">
        <div aria-hidden="true" className="absolute -right-14 -top-16 size-48 rounded-full bg-white/[0.035]" />
        <LanguageSelector tone="light" className="absolute right-4 top-4" />
        <div className="relative mx-auto flex size-[84px] items-center justify-center rounded-full bg-[#DDF56B] text-[#173F35]">
          <ProfileIcon />
        </div>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/65">{t("me.eyebrow")}</p>
        <h1 className="mt-1 text-[25px] font-semibold tracking-[-0.035em]">{t("me.title")}</h1>
        <p className="mt-2 text-sm text-white/75">{t("me.tagline")}</p>
        <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/75">
          <LockIcon />
          {t("me.private")}
        </p>
      </header>

      <section aria-label={t("me.impact")} className="grid grid-cols-3 border-b border-[#E3E2D8] bg-[#F8F6EF] px-2 py-6">
        <Stat label={t("me.stat.reports")} value={reports?.length} />
        <Stat label={t("me.stat.meToos")} value={meToos?.length} divider />
        <Stat label={t("me.stat.resolved")} value={resolved} divider />
      </section>

      {(!token || reports === undefined || meToos === undefined) && (
        <p role="status" className="px-5 pt-6 text-sm text-[#68756F]">
          {t("me.loading")}
        </p>
      )}
      {token && reports !== undefined && meToos !== undefined && (
        <div className="space-y-8 px-4 pt-7">
          <ReportSection
            title={t("me.requests.title")}
            empty={t("me.requests.empty")}
            reports={reports}
            now={now}
            token={token}
            onPostAnother={() => router.push("/post")}
          />
          <MeTooSection reports={meToos} now={now} />
        </div>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  divider = false,
}: {
  label: string;
  value: number | undefined;
  divider?: boolean;
}) {
  return (
    <div className={`px-1 text-center ${divider ? "border-l border-[#E3E2D8]" : ""}`}>
      <p className="text-[29px] font-semibold leading-none tracking-[-0.04em] text-[#173F35] tabular-nums">
        {value ?? <span className="inline-block h-7 w-7 animate-pulse rounded bg-[#E5E4DA] align-middle" />}
      </p>
      <p className="mt-2.5 text-xs font-medium text-[#68756F]">{label}</p>
    </div>
  );
}

function ReportSection({
  title,
  empty,
  reports,
  now,
  token,
  onPostAnother,
}: {
  title: string;
  empty: string;
  reports: OwnerReport[];
  now: number;
  token: string;
  onPostAnother: () => void;
}) {
  const t = useT();
  return (
    <section aria-label={title}>
      <SectionHeading title={title} count={reports.length} />
      {reports.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-[#D5D9CF] bg-[#F8F6EF] px-5 py-6 text-center">
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-[#6C7872]">{empty}</p>
          <button
            type="button"
            onClick={onPostAnother}
            className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-[#173F35] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#245446]"
          >
            {t("me.requests.post")}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map((report) => (
            <li key={report._id}>
              <MeReportCard report={report} now={now} token={token} onPostAnother={onPostAnother} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MeTooSection({ reports, now }: { reports: FollowedReport[]; now: number }) {
  const t = useT();
  return (
    <section aria-label={t("me.supported.title")}>
      <SectionHeading title={t("me.supported.title")} count={reports.length} />
      {reports.length === 0 ? (
        <p className="rounded-[18px] border border-dashed border-[#D5D9CF] bg-[#F8F6EF] p-5 text-sm text-[#6C7872]">
          {t("me.supported.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {reports.map(({ report }) => (
            <li key={report._id}>
              <MeReportCard report={report} now={now} isMeToo />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-[18px] font-semibold tracking-[-0.025em] text-[#18382F]">{title}</h2>
      <span className="text-xs font-medium text-[#77837D]">{count}</span>
    </div>
  );
}

function ProfileIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-3.3 3.1-5 7-5s6.3 1.7 7 5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
