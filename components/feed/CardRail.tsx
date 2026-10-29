"use client";

import { useState } from "react";
import { mutate, query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { neighborCanConfirm } from "@/server/lib/fixRules";
import { useResidentToken } from "@/lib/hooks/useResidentToken";
import { useT } from "@/lib/i18n/I18nProvider";
import type { FeedSlotProps } from "./FeedCard";

// The caller's relation to a report (GET /api/relation): which they posted and which they
// already me-too'd.
type Relation = { mine: string[]; meTooed: string[] };

// Me too with its count (§5.1.1, §2.1.1): one tap adds you to the problem. Hidden on fixed
// cards and on your own posts (§4.1.2 build-plan defaults). Sits above "Is it fixed?" in the
// right-hand column, or in its place when the card has none (see CardOverlay's layout note).
export default function CardRail({ report, near }: FeedSlotProps) {
  const t = useT();
  const token = useResidentToken();
  // Only near cards poll, so a long feed doesn't hold a request per card.
  const relation = useLive(token && near ? `relation:${token}:${report._id}` : null, (signal) =>
    query<Relation>("/api/relation", { reportIds: [report._id] }, { signal }),
  );
  // The count when the button was tapped. It shows pressed with one more at once; the server's
  // answer follows when the write settles and the feed and relation refetch (mutate() triggers
  // both). A failed write clears it.
  const [tappedAt, setTappedAt] = useState<number | null>(null);

  if (report.status !== "open" || !token || !relation || relation.mine.includes(report._id)) return null;
  const pressed = tappedAt !== null || relation.meTooed.includes(report._id);
  const count = tappedAt === null ? report.meTooCount : Math.max(report.meTooCount, tappedAt + 1);

  async function tap() {
    setTappedAt(report.meTooCount);
    try {
      await mutate("/api/me-too", { reportId: report._id });
    } catch {
      // Back to the server's truth: the count and button come from the refetch.
      setTappedAt(null);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void tap()}
      disabled={pressed}
      aria-pressed={pressed}
      aria-label={t("feed.meTooAria", { count })}
      className={`absolute right-2.5 z-[4] flex flex-col items-center gap-[3px] text-white ${
        neighborCanConfirm(report) ? "bottom-[302px]" : "bottom-[216px]"
      }`}
    >
      <span
        className={`flex size-[52px] items-center justify-center rounded-full border-[1.5px] ${
          pressed ? "border-[#157A47] bg-[#157A47]" : "border-white/35 bg-white/15"
        }`}
      >
        <HandIcon />
      </span>
      <span className="text-[11px] font-bold [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">
        {count > 0 ? t("feed.meTooCount", { count }) : t("feed.meToo")}
      </span>
    </button>
  );
}

function HandIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}
