"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/i18n/I18nProvider";

type Props = { photos: string[]; near: boolean };

// A photo post's slideshow (§5.1.1, layout after spec/UI_mockups). Its own horizontal
// scroll-snap strip, so a sideways swipe moves the photos and never the feed, which only
// scrolls vertically. Photos load only when the card is `near` (file bandwidth
// is limited). The strip is slot media (z-[2]); the dots and arrows are slot UI (z-[4]).
export default function Slideshow({ photos, near }: Props) {
  const t = useT();
  const strip = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;

  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    setIndex(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  };
  const go = (to: number) => {
    const el = strip.current;
    el?.scrollTo?.({ left: to * el.clientWidth, behavior: "smooth" });
  };

  return (
    <>
      <div
        ref={strip}
        onScroll={onScroll}
        data-testid="slideshow"
        className="absolute inset-0 z-[2] flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((url, j) => (
          <div key={j} className="relative h-full w-full shrink-0 snap-center snap-always bg-black">
            {near && (
              // MinIO URLs, so not next/image.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={t("feed.photoAlt", { n: j + 1, count })}
                loading={j === 0 ? "eager" : "lazy"}
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {count > 1 && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[66px] z-[4] flex justify-center gap-[5px]">
            {photos.map((_, j) => {
              const current = j === index;
              return (
                <span
                  key={j}
                  data-testid="slide-dot"
                  data-current={String(current)}
                  className={`h-1 rounded-sm transition-all ${current ? "w-[18px] bg-white" : "w-1.5 bg-white/50"}`}
                />
              );
            })}
          </div>
          <p className="pointer-events-none absolute right-3.5 top-20 z-[4] rounded-full bg-[rgba(10,18,30,.62)] px-[9px] py-1 text-xs font-bold text-white">
            {index + 1} / {count}
          </p>
          {index > 0 && <Arrow dir="prev" onClick={() => go(index - 1)} />}
          {index < count - 1 && <Arrow dir="next" onClick={() => go(index + 1)} />}
        </>
      )}
    </>
  );
}

// For a mouse, where there's no swipe. Hidden on touch screens, where the swipe is the gesture
// and the next arrow could cover the right-hand button column (Me too, Fixed?, On map) on a short
// phone. At the mockup's height (top 300px).
function Arrow({ dir, onClick }: { dir: "prev" | "next"; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir === "prev" ? t("feed.prevPhoto") : t("feed.nextPhoto")}
      className={`absolute top-[300px] z-[4] flex size-10 [@media(pointer:coarse)]:hidden items-center justify-center rounded-full bg-[rgba(10,18,30,.55)] text-white ${dir === "prev" ? "left-2" : "right-2"}`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={dir === "prev" ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
      </svg>
    </button>
  );
}
