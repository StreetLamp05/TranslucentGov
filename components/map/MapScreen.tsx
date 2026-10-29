"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ACTIVE_CITY } from "../../server/lib/city";
import { query } from "../../lib/data/api";
import { useLive } from "../../lib/data/useLive";
import type { MapReport } from "../../server/map";
import { useDemoMode } from "../../lib/hooks/useDemoMode";
import type { MessageKey } from "../../lib/i18n/dictionary";
import { useT } from "../../lib/i18n/I18nProvider";
import { clusterCount, MIXED_COLOR, STATUS_COLOR, type MapStatus } from "./counts";
import ReportsMap from "./ReportsMap";

// The Map tab (§5.2.1), after the map screen in spec/UI_mockups. City leadership uses
// this same map; there's no separate dashboard.
type Filter = "all" | MapStatus;

export default function MapScreen() {
  const t = useT();
  const reports = useLive("map", (signal) => query<MapReport[]>("/api/map", {}, { signal }));
  const router = useRouter();
  const focusId = useSearchParams().get("report");
  const demo = useDemoMode();
  const [filter, setFilter] = useState<Filter>("all");

  const all = reports ?? [];
  const visible = filter === "all" ? all : all.filter((r) => r.status === filter);
  const openN = all.filter((r) => r.status === "open").length;
  const fixedN = all.length - openN;

  const filters: [Filter, string][] = [
    ["all", t("map.filter.all")],
    ["open", t("map.filter.open", { count: openN })],
    ["fixed", t("map.filter.fixed", { count: fixedN })],
  ];

  return (
    // Fixed between the demo banner (26px, when shown) and the tab bar, so map gestures
    // never scroll the page.
    <main className={`fixed inset-x-0 bottom-16 mx-auto max-w-md ${demo ? "top-[26px]" : "top-0"}`}>
      {/* Push, not replace, so Back from the feed returns here (§5.2.1). */}
      <ReportsMap reports={visible} focusId={focusId} onOpen={(id) => router.push(`/?report=${id}`)} />

      <div className="absolute inset-x-3 top-3 flex flex-col gap-2.5 rounded-[20px] border border-[#E7E7DE] bg-[#FFFEFA] py-3.5 pr-3 pl-3.5 shadow-[0_8px_24px_rgba(24,56,47,.12)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-[-0.02em] text-[#18382F]">{t("map.screen.title", { city: ACTIVE_CITY.name })}</h1>
            <p className="mt-0.5 text-xs font-medium text-[#68756F]">
              {reports === undefined
                ? t("map.screen.loading")
                : t("map.screen.summary", { open: openN, fixed: fixedN, people: clusterCount(all) })}
            </p>
          </div>
          <span className="inline-flex items-center gap-[5px] rounded-full bg-[#EDF2E5] px-2 py-1 text-[11px] font-bold text-[#315741]">
            <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-[#4B7951]" />
            {t("map.screen.live")}
          </span>
        </div>
        <div role="group" aria-label={t("map.screen.filterLabel")} className="flex gap-[3px] rounded-[12px] bg-[#F0F0E9] p-[3px]">
          {filters.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`h-[34px] flex-1 rounded-[9px] text-[13px] font-semibold ${
                filter === key ? "bg-[#FFFEFA] text-[#18382F] shadow-[0_1px_3px_rgba(24,56,47,.10)]" : "text-[#68756F]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Above Google's logo, which has to stay visible. */}
      <div
        role="group"
        aria-label={t("map.legend.label")}
        className="absolute bottom-9 left-3 flex flex-col gap-[5px] rounded-[14px] border border-[#E7E7DE] bg-[#FFFEFA] px-3 py-[9px] text-xs font-semibold text-[#3F5148] shadow-[0_4px_14px_rgba(24,56,47,.12)]"
      >
        <div className="flex items-center gap-3">
          {LEGEND.map(([labelKey, color]) => (
            <span key={labelKey} className="inline-flex items-center gap-[5px]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
              {t(labelKey)}
            </span>
          ))}
        </div>
        <div className="font-medium text-[#68756F]">{t("map.legend.hint")}</div>
      </div>
    </main>
  );
}

const LEGEND: [MessageKey, string][] = [
  ["map.legend.open", STATUS_COLOR.open],
  ["map.legend.fixed", STATUS_COLOR.fixed],
  ["map.legend.mixed", MIXED_COLOR],
];
