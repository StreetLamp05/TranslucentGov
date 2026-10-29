"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { fixedLine } from "@/components/feed/CardOverlay";
import Slideshow from "@/components/feed/Slideshow";
import type { PublicReport } from "@/server/lib/publicReport";
import { mutate } from "@/lib/data/api";
import { daysLabel, daysOpen } from "@/lib/days";
import { useSoundUnlocked } from "@/lib/hooks/sound";

// The before/after reveal on a fixed report (§5.1.1): the original clip (or slideshow), a ~0.7 s
// "FIXED · N days · <who>" stamp, the fix clip, and around again.
export const STAMP_MS = 700;
// How long a slideshow (no clip) shows before the stamp.
export const PHOTO_HOLD_MS = 4000;

export type RevealPhase = "original" | "stamp" | "fix";

export type RevealReport = Pick<
  PublicReport,
  | "_id"
  | "clipUrl"
  | "frameUrls"
  | "fixUrl"
  | "audioMuted"
  | "createdAt"
  | "fixedAt"
  | "fixedByKind"
  | "fixedByLabel"
  | "agency"
  | "owner"
>;

type Props = {
  report: RevealReport;
  // Plays while true. Going false resets to the original.
  active: boolean;
  // Load the fix clip (and, standalone, the original) only when near (file bandwidth
  // is limited).
  near?: boolean;
  // Feed: the pooled element playing the original, which the pool starts (null for a
  // slideshow, which CardOverlay draws). The player takes it over with `loop = false`.
  video?: HTMLVideoElement | null;
  // Me page (US24): draw the original too, inside a box of its own.
  standalone?: boolean;
  // Each time the stamp plays. The feed records a reveal view with it (§6.2.1).
  onStamp?: () => void;
};

/**
 * Plays original → stamp → fix → original. In the feed it renders a fragment (the fix clip at
 * z-[2], the stamp at z-[5]; see FeedCard's layers). Standalone, it renders its own box.
 */
export default function RevealPlayer({ report, active, near = true, video = null, standalone = false, onStamp }: Props) {
  const [phase, setPhase] = useState<RevealPhase>("original");
  // Finished loops. On the first pass the pool has already started the original.
  const [pass, setPass] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) {
      setPhase("original");
      setPass(0);
    }
  }

  const [ownVideo, setOwnVideo] = useState<HTMLVideoElement | null>(null);
  const original = standalone ? ownVideo : video;
  const fix = useRef<HTMLVideoElement>(null);
  const fixUrl = near ? report.fixUrl : null;

  const unlocked = useSoundUnlocked();
  // Take over from the pool: it no longer loops the clip or restarts it on a tap, and the clip
  // ends, so `ended` fires. `restart` plays it from the top (every pass but the feed's first).
  const takeOver = useEffectEvent((el: HTMLVideoElement, restart: boolean) => {
    el.loop = false;
    if (!restart) return;
    if (standalone) el.muted = !unlocked || report.audioMuted;
    el.currentTime = 0;
    play(el);
  });
  const stamped = useEffectEvent(() => onStamp?.());

  useEffect(() => {
    if (!active || phase !== "original") return;
    const toStamp = () => setPhase("stamp");
    if (!original) {
      const timer = setTimeout(toStamp, PHOTO_HOLD_MS);
      return () => clearTimeout(timer);
    }
    takeOver(original, pass > 0 || standalone);
    // The pool's src effect runs after this one in the same commit (parent effects run after
    // child effects) and turns loop back on when it points the element at this card: on first
    // mount, a deep link, or a jump past the preloaded card. Take over again once it loads or plays.
    const retake = () => takeOver(original, false);
    original.addEventListener("loadstart", retake);
    original.addEventListener("play", retake);
    original.addEventListener("ended", toStamp);
    // A clip that can't load never ends: hold on its poster like a slideshow, so the fix still shows.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const failed = () => {
      clearTimeout(timer);
      timer = setTimeout(toStamp, PHOTO_HOLD_MS);
    };
    original.addEventListener("error", failed);
    if (original.error) failed();
    // A clip that ended before this listener was added.
    else if (original.ended) timer = setTimeout(toStamp, 0);
    return () => {
      original.removeEventListener("loadstart", retake);
      original.removeEventListener("play", retake);
      original.removeEventListener("ended", toStamp);
      original.removeEventListener("error", failed);
      clearTimeout(timer);
    };
  }, [active, phase, original, pass, standalone]);

  useEffect(() => {
    if (!active || phase !== "stamp") return;
    stamped();
    const timer = setTimeout(() => setPhase("fix"), STAMP_MS);
    return () => clearTimeout(timer);
  }, [active, phase]);

  useEffect(() => {
    if (!active || phase !== "fix") return;
    let live = true;
    const back = () => {
      if (!live) return;
      setPhase("original");
      setPass((n) => n + 1);
    };
    const el = fix.current;
    if (!el || !fixUrl || el.error) {
      const timer = setTimeout(back, 0);
      return () => clearTimeout(timer);
    }
    // Always muted, even after the sound unlock: uploaded fix clips may carry audio (§4.3.1, §6.1.1).
    el.muted = true;
    el.currentTime = 0;
    el.addEventListener("ended", back);
    el.addEventListener("error", back);
    el.play().catch(back);
    return () => {
      live = false;
      el.removeEventListener("ended", back);
      el.removeEventListener("error", back);
      el.pause();
    };
  }, [active, phase, fixUrl]);

  // Taps, the way the pool handles them for other cards. Muted autoplay can be refused (iOS
  // Low Power Mode), and the pool stops resuming the original once loop is off, so resume it
  // here, but never during the stamp or the fix clip. Also play the fix clip once inside the
  // tap, so iOS lets it play later without one.
  useEffect(() => {
    if (!active) return;
    const onTap = () => {
      if (phase === "fix") return;
      if (phase === "original" && original?.paused && !original.ended) play(original);
      const el = fix.current;
      if (el?.getAttribute("src")) {
        el.muted = true;
        el.play().catch(() => {});
        el.pause();
      }
    };
    window.addEventListener("click", onTap, { capture: true });
    return () => window.removeEventListener("click", onTap, { capture: true });
  }, [active, phase, original]);

  const photos = report.frameUrls.filter((url): url is string => !!url);
  const media = (
    <>
      {standalone &&
        (report.clipUrl ? (
          <video
            ref={setOwnVideo}
            src={near ? report.clipUrl : undefined}
            poster={photos[0]}
            aria-hidden="true"
            playsInline
            muted
            className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover"
          />
        ) : (
          photos.length > 0 && <Slideshow photos={photos} near={near} />
        ))}
      {report.fixUrl && (
        <video
          ref={fix}
          data-testid="fix-clip"
          data-phase={phase}
          src={fixUrl ?? undefined}
          preload={fixUrl ? "auto" : "none"}
          aria-hidden="true"
          playsInline
          muted
          className={`pointer-events-none absolute inset-0 z-[2] h-full w-full object-cover ${phase === "fix" ? "" : "invisible"}`}
        />
      )}
      {active && phase === "stamp" && <Stamp text={stampText(report)} />}
    </>
  );
  return standalone ? <div className="relative h-full w-full overflow-hidden bg-black">{media}</div> : media;
}

// "FIXED · 9 days · Fixed by Mableton Sanitation" or "FIXED · 9 days · Fix confirmed by a
// neighbor · Cobb DOT" (§4.3.2). Days run from createdAt to fixedAt, as on the status chip.
export function stampText(
  report: Pick<RevealReport, "createdAt" | "fixedAt" | "fixedByKind" | "fixedByLabel" | "agency" | "owner">,
): string {
  const parts = ["FIXED"];
  if (report.fixedAt !== undefined) {
    const days = daysOpen(report.createdAt, report.fixedAt);
    parts.push(days === 0 ? "same day" : daysLabel(days));
  }
  const who = fixedLine(report);
  if (who) parts.push(who);
  return parts.join(" · ");
}

function Stamp({ text }: { text: string }) {
  const stamp = useRef<HTMLDivElement>(null);
  // Slam in. The Web Animations API needs no stylesheet; jsdom doesn't have it.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    stamp.current?.animate?.(
      [
        { opacity: 0, transform: "scale(1.8)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 160, easing: "cubic-bezier(.2,.9,.3,1.2)" },
    );
  }, []);
  const [word, ...detail] = text.split(" · ");
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center px-6">
      <div
        ref={stamp}
        role="img"
        aria-label={text}
        data-testid="fixed-stamp"
        className="-rotate-6 rounded-2xl border-4 border-white bg-[#157A47]/90 px-6 py-3 text-center text-white shadow-[0_8px_30px_rgba(0,0,0,.5)]"
      >
        <p className="text-5xl font-black tracking-[.14em]">{word}</p>
        {detail.length > 0 && <p className="mt-1 text-sm font-bold leading-snug">{detail.join(" · ")}</p>}
      </div>
    </div>
  );
}

// If iOS refuses unmuted playback, play muted instead of not at all (same fallback as the feed's pool).
function play(el: HTMLVideoElement) {
  el.play().catch(() => {
    if (el.muted) return;
    el.muted = true;
    el.play().catch(() => {});
  });
}

// sessionStorage keeps a reveal view to one per report per session (§6.2.1). The Set also
// covers the page's life on its own when storage is blocked or full (private mode, quota).
const SEEN_KEY = "govtok:revealViewed:";
const seenThisPage = new Set<string>();

function seen(key: string): boolean {
  if (seenThisPage.has(key)) return true;
  try {
    return window.sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function markSeen(key: string, on: boolean) {
  if (on) seenThisPage.add(key);
  else seenThisPage.delete(key);
  try {
    if (on) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // The Set has it.
  }
}

/** Calls `record` the first time it's asked for a report this session. Retries later if it fails. */
export function recordRevealViewOnce(
  reportId: string,
  record: (args: { reportId: string }) => Promise<unknown>,
): void {
  const key = SEEN_KEY + reportId;
  if (seen(key)) return;
  markSeen(key, true);
  record({ reportId }).catch(() => markSeen(key, false));
}

const record = (args: { reportId: string }) => mutate("/api/reveal", args);

/** `recordRevealViewOnce` bound to POST /api/reveal. */
export function useRecordRevealView(): (reportId: string) => void {
  return useCallback((reportId: string) => recordRevealViewOnce(reportId, record), []);
}
