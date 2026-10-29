"use client";

import Link from "next/link";
import { useState } from "react";
import { HoldDebug, Retake, ScreeningFailed } from "@/components/post/CheckingScreen";
import RevealPlayer from "@/components/RevealPlayer";
import type { OwnerReport, PublicReport } from "@/server/lib/publicReport";
import { SCREENING_FAILED_REASON } from "@/server/lib/screening";
import { daysLabel, daysOpen } from "@/lib/days";
import { translate } from "@/lib/i18n/dictionary";
import { useT, type TFunction } from "@/lib/i18n/I18nProvider";

type Props = {
  report: OwnerReport | PublicReport;
  now: number;
  token?: string | null;
  isMeToo?: boolean;
  onPostAnother?: () => void;
};

const englishT: TFunction = (key, vars) => translate("en", key, vars);

// The badge on a card. English unless the caller passes the chosen language's `t`.
export function reportStatusText(report: OwnerReport | PublicReport, now: number, t: TFunction = englishT): string {
  if (report.status === "pending") return t("me.status.checking");
  if (report.status === "held") {
    if (report.verdict === "emergency") return t("me.status.emergency");
    if (report.verdict === "retake") return t("me.status.retake");
    if (report.verdict === "reject") return t("me.status.notPosted");
    if (report.reason === SCREENING_FAILED_REASON) return t("me.status.screeningFailed");
    return t("me.status.notPosted");
  }
  // "Open · N days" counts from createdAt; "Fixed in N days" freezes at fixedAt (§2.1.3).
  if (report.status === "fixed") {
    if (report.fixedAt === undefined) return t("me.status.fixed");
    const days = daysOpen(report.createdAt, report.fixedAt);
    return days === 0 ? t("me.status.fixedSameDay") : t("me.status.fixedIn", { days: daysLabel(days, t) });
  }
  const days = daysOpen(report.createdAt, now);
  return days === 0 ? t("me.status.openToday") : t("me.status.openDays", { days: daysLabel(days, t) });
}

export default function MeReportCard({ report, now, token = null, isMeToo = false, onPostAnother }: Props) {
  const t = useT();
  const fixed = report.status === "fixed";
  const held = report.status === "held" ? (report as OwnerReport) : null;
  const publicReport = report.status === "open" || fixed;
  const status = reportStatusText(report, now, t);
  const [playing, setPlaying] = useState(false);
  const href = `/?report=${report._id}`;
  const thumbnail = report.frameUrls[0];
  const activityAt = fixed && report.fixedAt !== undefined ? report.fixedAt : report.createdAt;
  const activityAge = daysOpen(activityAt, now);

  return (
    <article
      aria-label={report.title ?? t("me.card.untitledLabel")}
      data-status={report.status}
      className={`overflow-hidden rounded-[18px] border bg-[#FFFEFA] shadow-[0_2px_8px_rgba(24,56,47,.045)] ${
        fixed ? "border-[#87A58A] ring-2 ring-[#4B7951]/20" : "border-[#E7E6DE]"
      }`}
    >
      <div className="flex gap-3 p-3.5">
        <div className="relative size-[76px] shrink-0 overflow-hidden rounded-[13px] bg-[#E7E9E0]">
          {thumbnail ? (
            // MinIO URLs are not configured for next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[#87938B]" aria-hidden="true">
              <ReportIcon />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 py-0.5">
          {report.isSample && (
            <span className="mb-1 inline-block rounded-md bg-[#F0F2E9] px-2 py-[3px] text-[10px] font-bold tracking-[.02em] text-[#52634F]">
              {t("me.card.sample")}
            </span>
          )}
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${fixed ? "bg-[#4B7951]" : held ? "bg-[#B88338]" : "bg-[#D49B35]"}`} />
            <span className={`text-[10px] font-bold uppercase tracking-[.09em] ${fixed ? "text-[#426B48]" : held ? "text-[#8E632A]" : "text-[#68756F]"}`}>
              {status}
            </span>
          </div>
          <h2 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-[-.015em] text-[#1C342D]">
            {report.title ?? t("me.card.untitled")}
          </h2>
          {report.street && <p className="mt-1 truncate text-xs text-[#748079]">{report.street}</p>}
          {report.status === "open" && (
            <p className="mt-1.5 text-[11px] text-[#748079]">
              {isMeToo ? t("me.card.meTooed") : report.audioMuted ? t("me.card.audioMuted") : t("me.card.posted")} ·{" "}
              {report.meTooCount === 1 ? t("me.card.meTooOne") : t("me.card.meTooOther", { count: report.meTooCount })}
            </p>
          )}
          {(report.status === "pending" || fixed) && (
            <p className="mt-1.5 text-[11px] text-[#87918B]">
              {activityAge === 0
                ? t(fixed ? "me.card.resolvedToday" : "me.card.postedToday")
                : t(fixed ? "me.card.resolvedAgo" : "me.card.postedAgo", { days: daysLabel(activityAge, t) })}
            </p>
          )}
        </div>
        {publicReport && (
          <Link
            href={href}
            aria-label={t("me.card.view")}
            className="flex size-8 shrink-0 items-center justify-center self-center rounded-full text-[#728078] transition-colors hover:bg-[#EEF0E8] focus-visible:outline-2 focus-visible:outline-[#173F35]"
          >
            <ChevronIcon />
          </Link>
        )}
      </div>

      {fixed && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAEAE1] bg-[#F5F7EF] px-4 py-2.5">
          <span className="text-xs font-medium text-[#48634F]">{t("me.card.fixedNote")}</span>
          <button
            type="button"
            aria-pressed={playing}
            onClick={() => setPlaying((on) => !on)}
            className="min-h-9 rounded-lg bg-[#173F35] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#245446]"
          >
            {playing ? t("me.card.hideFix") : t("me.card.playFix")}
          </button>
        </div>
      )}
      {fixed && playing && (
        <div data-testid="me-reveal" className="mx-auto aspect-[9/16] w-full max-w-xs overflow-hidden rounded-b-[18px]">
          <RevealPlayer report={report} active standalone />
        </div>
      )}
      {held && held.reason && held.verdict !== "retake" && held.reason !== SCREENING_FAILED_REASON && (
        <div className="border-t border-[#EAEAE1] bg-[#FBF6E9] px-4 py-3">
          <p className="text-sm leading-relaxed text-[#776A4B]">{held.reason}</p>
          {(held.verdict === "reject" || held.verdict === "emergency") && <HoldDebug report={held} />}
        </div>
      )}
      {held?.verdict === "emergency" && (
        <div className="border-t border-[#F0D9D4] bg-[#FFF5F2] px-4 py-3">
          <a href="tel:911" className="inline-flex min-h-10 items-center rounded-xl bg-[#A33F2B] px-4 text-sm font-semibold text-white">
            {t("me.card.call911")}
          </a>
        </div>
      )}
      {held?.verdict === "retake" && !isMeToo && (
        <div className="border-t border-[#EAEAE1] px-3.5 py-3">
          <Retake token={token} report={held} />
        </div>
      )}
      {held?.reason === SCREENING_FAILED_REASON && !isMeToo && (
        <div className="border-t border-[#EAEAE1] px-3.5 py-3">
          <ScreeningFailed token={token} report={held} onPostAnother={onPostAnother} />
        </div>
      )}
      {fixed && <p className="sr-only">{t("me.card.fixedReport")}</p>}
    </article>
  );
}

function ReportIcon() {
  return (
    <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
