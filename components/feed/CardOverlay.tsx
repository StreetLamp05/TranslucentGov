"use client";

import Link from "next/link";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { PublicReport } from "@/server/lib/publicReport";
import { OWNER_CHIP } from "@/server/lib/routing";
import { captionAt } from "@/lib/captions";
import { daysLabel, daysOpen } from "@/lib/days";
import type { FeedSlotProps } from "./FeedCard";
import Slideshow from "./Slideshow";

// What the card says (§5.1.1, layout after spec/UI_mockups): Sample badge (§6.1.1), owner chip
// (§2.1.2), status, title, street, description, captions, the slideshow for photo posts and the
// "On map" pin (§5.2.1), plus who fixed it on fixed cards (§4.3.2). Captions sit in a band at the
// top, below the safe area and the slideshow's dots (top-[66px]), and clear of its counter (right-3.5)
// via the right-20 inset, so the middle of the frame stays visible. A fragment, so it creates no
// stacking context: the slideshow sits in the slot-media layer (z-[2]) and everything else in the
// slot-UI layer (z-[4]). Text layers ignore pointer events, so a swipe over them still moves the
// slideshow.
//
// The right-hand button column (spec/UI_mockups) is split across slots. "On map" is its bottom
// item, anchored at bottom-[130px] right-2.5: a 52px circle, a 3px gap and a ~14px label, so
// ~70px tall. CardRail (US18, Me too) and CardActions (US23, Fixed?) stack above it with the
// mockup's 16px gap, e.g. Fixed? at bottom-[216px] and Me too above that. Don't anchor them at
// bottom-[130px] too, or they cover the pin.
export default function CardOverlay({ report, active, near, video }: FeedSlotProps) {
  const [now] = useState(() => Date.now());
  const caption = useCaption(report, active ? video : null);
  const chip = OWNER_CHIP[report.owner ?? "unknown"];
  const fixed = report.status === "fixed";
  const photos = report.mediaType === "photos" ? report.frameUrls.filter((url): url is string => !!url) : [];

  return (
    <>
      {photos.length > 0 && <Slideshow photos={photos} near={near} />}

      {caption && (
        <div
          data-testid="caption-band"
          className="pointer-events-none absolute left-5 right-20 top-[calc(env(safe-area-inset-top,0px)+78px)] z-[4] flex justify-center"
        >
          <p data-testid="caption" className="line-clamp-3 rounded-lg bg-black/60 px-2.5 py-1.5 text-center text-base font-bold leading-snug text-white">
            {caption}
          </p>
        </div>
      )}

      <Link
        href={`/map?report=${report._id}`}
        aria-label="Show on map"
        className="absolute bottom-[130px] right-2.5 z-[4] flex flex-col items-center gap-[3px] text-white"
      >
        <span className="flex size-[52px] items-center justify-center rounded-full border-[1.5px] border-white/35 bg-white/15">
          <PinIcon size={24} />
        </span>
        <span className="text-[11px] font-bold [text-shadow:0_1px_2px_rgba(0,0,0,.6)]">On map</span>
      </Link>

      <div className="pointer-events-none absolute bottom-[18px] left-3.5 right-[84px] z-[4] flex flex-col gap-2 text-white">
        {report.isSample && (
          <span className="self-start rounded-md bg-white/20 px-2 py-[3px] text-[11px] font-bold tracking-[.02em]">
            Sample · filmed in California
          </span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            data-testid="owner-chip"
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/30 bg-[rgba(10,18,30,.62)] px-2.5 text-xs font-bold"
          >
            <span data-testid="owner-dot" className="size-2 rounded-full" style={{ background: chip.dot }} />
            {report.agency ?? chip.label}
          </span>
          <span
            data-testid="status"
            className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-extrabold text-white ${fixed ? "bg-[#157A47]" : "bg-[#C2410C]"}`}
          >
            {statusText(report, now)}
          </span>
        </div>
        <h2 className="text-[19px] font-extrabold leading-tight [text-shadow:0_1px_2px_rgba(0,0,0,.4)]">
          {report.title ?? "Untitled report"}
        </h2>
        {report.street && (
          <p className="flex items-center gap-[5px] text-[13px] font-semibold text-white/90">
            <PinIcon size={14} />
            {report.street}
          </p>
        )}
        {fixed && fixedLine(report) && (
          <p data-testid="fixed-by" className="flex items-center gap-1.5 text-[13px] font-bold text-[#86EFAC]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            {fixedLine(report)}
          </p>
        )}
        {/* The public projection already drops these when muted (§4.2.1); hide them here too. */}
        {!report.audioMuted && report.description && (
          <p data-testid="description" className="text-sm leading-snug text-white/90">
            {report.description}
          </p>
        )}
        {report.audioMuted && (
          <p className="text-xs font-semibold text-white/80">Audio muted by screening · no captions</p>
        )}
      </div>
    </>
  );
}

// "Open · N days" counts from createdAt; "Fixed in N days" freezes at fixedAt (§2.1.3).
export function statusText(report: Pick<PublicReport, "status" | "createdAt" | "fixedAt">, now: number): string {
  if (report.status === "fixed") {
    if (report.fixedAt === undefined) return "Fixed";
    const days = daysOpen(report.createdAt, report.fixedAt);
    return days === 0 ? "Fixed same day" : `Fixed in ${daysLabel(days)}`;
  }
  const days = daysOpen(report.createdAt, now);
  return days === 0 ? "Open · today" : `Open · ${daysLabel(days)}`;
}

// Who closed it (§4.3.2): the fixer's org (§3.1.2), never a person, or a neighbor plus the
// owning agency. Null for a fixed report with no fixer recorded.
export function fixedLine(report: Pick<PublicReport, "fixedByKind" | "fixedByLabel" | "agency" | "owner">): string | null {
  if (report.fixedByKind === "resident") {
    return `Fix confirmed by a neighbor · ${report.agency ?? OWNER_CHIP[report.owner ?? "unknown"].label}`;
  }
  return report.fixedByKind === "fixer" && report.fixedByLabel ? `Fixed by ${report.fixedByLabel}` : null;
}

// The caption for where `video` is in this report's clip. Null while the card isn't on screen,
// for muted reports (§4.2.1), while the element plays something else, and once the clip has
// ended: on a fixed card the original ends and stays ended through US19's stamp and fix clip.
// Other cards never end, because the pool sets `loop` whenever it points an element at a card.
function useCaption(report: PublicReport, video: HTMLVideoElement | null): string | null {
  const segments = report.audioMuted ? undefined : report.segments;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!video) return () => {};
      VIDEO_EVENTS.forEach((e) => video.addEventListener(e, onChange));
      return () => VIDEO_EVENTS.forEach((e) => video.removeEventListener(e, onChange));
    },
    [video],
  );
  const caption = () =>
    video && report.clipUrl && video.getAttribute("src") === report.clipUrl && !video.ended
      ? captionAt(segments, video.currentTime)
      : null;
  return useSyncExternalStore(subscribe, caption, () => null);
}

// timeupdate fires about 4 times a second while playing, often enough for captions.
const VIDEO_EVENTS = ["timeupdate", "seeked", "emptied", "loadstart", "ended"] as const;

function PinIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
