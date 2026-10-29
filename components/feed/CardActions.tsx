import Link from "next/link";
import { neighborCanConfirm } from "@/server/lib/fixRules";
import type { FeedSlotProps } from "./FeedCard";

// "Is it fixed?" on open cards the city doesn't own (§4.3.2, §5.1.1): any resident can film a
// proof of fix through the same pipeline as a fixer (/confirm/<id>). Sits above "On map" in the
// right-hand column, per CardOverlay's layout note.
export default function CardActions({ report }: FeedSlotProps) {
  if (!neighborCanConfirm(report)) return null;
  return (
    <Link
      href={`/confirm/${report._id}`}
      aria-label="Is it fixed?"
      className="absolute bottom-[216px] right-2.5 z-[4] flex flex-col items-center gap-[3px] text-white"
    >
      <span className="flex size-[52px] items-center justify-center rounded-full border-[1.5px] border-white/35 bg-white/15">
        <CheckIcon />
      </span>
      <span className="text-[11px] font-bold [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">Is it fixed?</span>
    </Link>
  );
}

function CheckIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
