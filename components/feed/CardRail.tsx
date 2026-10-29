"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { neighborCanConfirm } from "@/server/lib/fixRules";
import type { PublicReport } from "@/convex/lib/publicReport";
import { useResidentToken } from "@/lib/hooks/useResidentToken";
import type { FeedSlotProps } from "./FeedCard";

// Me too with its count (§5.1.1, §2.1.1): one tap adds you to the problem. Hidden on fixed
// cards and on your own posts (§4.1.2 build-plan defaults). Sits above "Is it fixed?" in the
// right-hand column, or in its place when the card has none (see CardOverlay's layout note).
export default function CardRail({ report, near }: FeedSlotProps) {
  const token = useResidentToken();
  // Only near cards subscribe, so a long feed doesn't hold a query per card.
  const relation = useQuery(api.relation.myRelation, token && near ? { token, reportIds: [report._id] } : "skip");
  const meToo = useMutation(api.meToos.meToo).withOptimisticUpdate((store, { reportId }) => {
    const bump = (r: PublicReport): PublicReport => (r._id === reportId ? { ...r, meTooCount: r.meTooCount + 1 } : r);
    const feed = store.getQuery(api.feed.feed, {});
    if (feed) store.setQuery(api.feed.feed, {}, feed.map(bump));
    for (const { args, value } of store.getAllQueries(api.feed.reportById)) {
      if (value) store.setQuery(api.feed.reportById, args, bump(value));
    }
    for (const { args, value } of store.getAllQueries(api.relation.myRelation)) {
      if (value && args.reportIds.includes(reportId) && !value.meTooed.includes(reportId)) {
        store.setQuery(api.relation.myRelation, args, { ...value, meTooed: [...value.meTooed, reportId] });
      }
    }
  });

  if (report.status !== "open" || !token || !relation || relation.mine.includes(report._id)) return null;
  const pressed = relation.meTooed.includes(report._id);
  const count = report.meTooCount;

  async function tap() {
    try {
      await meToo({ token: token!, reportId: report._id });
    } catch {
      // The optimistic update rolls back, so the count and button show the server's truth.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void tap()}
      disabled={pressed}
      aria-pressed={pressed}
      aria-label={`Me too, ${count} so far`}
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
        {count > 0 ? `Me too · ${count}` : "Me too"}
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
