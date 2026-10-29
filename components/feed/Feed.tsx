"use client";

import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PublicReport } from "@/server/lib/publicReport";
import { query } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";
import { useSoundUnlocked } from "@/lib/hooks/sound";
import { useDemoMode } from "@/lib/hooks/useDemoMode";
import FeedCard from "./FeedCard";
import { RevealPausedContext } from "@/components/RevealPlayer";
import PausedIcon from "./PausedIcon";

// Pooled <video> elements. Card k always uses slot k % 3, so {previous, on screen, next} never
// collide and a slot keeps its element as cards scroll past. Only `src` and position change,
// so iOS keeps the sound unlock on elements the user has already played with sound.
const POOL_SIZE = 3;
const VISIBLE = 0.6;

/**
 * The full-screen feed (§5.1.1, §5.1.2). `firstId` (from `/?report=<id>`) opens with that card
 * first. The order is snapshotted on mount; remount the feed (a new key) to re-sort it.
 */
export default function Feed({ firstId }: { firstId?: string }) {
  const live = useLive("feed", (signal) => query<PublicReport[]>("/api/feed", {}, { signal }));
  const pinned = useLive(firstId ? `feed:${firstId}` : null, (signal) =>
    query<PublicReport | null>(`/api/feed/${encodeURIComponent(firstId!)}`, {}, { signal }),
  );
  const reports = useFeedSnapshot(live, firstId ? pinned : null);
  const count = reports?.length ?? 0;

  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // The card at least 60% on screen is the one that plays. Snapping means there's one. Check
  // the ratio, not just isIntersecting: a card leaving the screen crosses the threshold on
  // the way out while still intersecting.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE) setActive(Number((entry.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: VISIBLE },
    );
    root.querySelectorAll("article[data-index]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [count]);

  // The user paused the card on screen with a tap. A swipe to another card clears it, so the new
  // card plays and a paused card resumes when the user comes back. The ref is for event handlers.
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [pausedOn, setPausedOn] = useState(active);
  if (active !== pausedOn) {
    setPausedOn(active);
    setPaused(false);
  }
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const [videos, setVideos] = useState<(HTMLVideoElement | null)[]>(() => Array(POOL_SIZE).fill(null));
  const videoRefs = useMemo(
    () =>
      Array.from({ length: POOL_SIZE }, (_, slot) => (el: HTMLVideoElement | null) => {
        setVideos((prev) => (prev[slot] === el ? prev : prev.map((v, i) => (i === slot ? el : v))));
      }),
    [],
  );

  // The card index each slot shows: whichever of previous / on screen / next maps to it.
  const slots = Array.from({ length: POOL_SIZE }, (_, slot) => {
    const k = [active - 1, active, active + 1].find((i) => i >= 0 && i < count && i % POOL_SIZE === slot);
    return k !== undefined && reports?.[k].clipUrl ? k : null;
  });
  const slotKey = slots.map((k) => (k === null ? "" : reports![k]._id)).join(",");

  const unlocked = useSoundUnlocked();
  // Muted until the first tap; `audioMuted` reports never unmute (§4.2.1).
  const mutedFor = (report: PublicReport, el: HTMLVideoElement) =>
    !unlocked || report.audioMuted || el.dataset.silent === "true";

  // Point each slot's element at its card. Resets what CardReveal may have changed.
  useEffect(() => {
    videos.forEach((el, slot) => {
      if (!el) return;
      const k = slots[slot];
      const report = k === null ? null : reports![k];
      const src = report?.clipUrl ?? null;
      if (el.getAttribute("src") === src) return;
      el.pause();
      el.loop = true;
      delete el.dataset.silent;
      if (report?.frameUrls[0]) el.poster = report.frameUrls[0];
      else el.removeAttribute("poster");
      if (src) el.src = src;
      else {
        el.removeAttribute("src");
        el.load();
      }
    });
    // slotKey stands for slots and the reports they show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, slotKey]);

  // Only the card on screen plays. Bandwidth: only the next card preloads (MinIO serves
  // from the homelab's uplink); the previous one was already loaded on the way down.
  useEffect(() => {
    videos.forEach((el, slot) => {
      const k = slots[slot];
      if (!el || k === null) return;
      el.preload = k === active - 1 ? "none" : "auto";
      el.muted = mutedFor(reports![k], el);
      if (k === active) {
        if (!pausedRef.current) play(el);
      } else if (!el.paused || el.currentTime > 0) {
        el.pause();
        el.currentTime = 0; // off-screen cards show frame 0
      }
    });
    // Not on live count updates: re-unmuting a playing video outside a tap pauses it on iOS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, slotKey, active]);

  // The sound unlock (US6). Runs inside the tap: unmute the card on screen, and play every
  // pooled element once (empty ones too: card 2 gets the third element later), so iOS lets
  // each of them play with sound after later src swaps. Never restarts the card on screen:
  // it only resumes it if it's paused while the pool still owns it (`loop`, see CardReveal).
  const applySound = () => {
    if (!unlocked) return;
    videos.forEach((el, slot) => {
      if (!el) return;
      const k = slots[slot];
      if (k !== null) el.muted = mutedFor(reports![k], el);
      if (k === active) {
        if (el.paused && el.loop && !pausedRef.current) play(el);
        return;
      }
      el.play().catch(() => {});
      el.pause();
    });
  };
  const onUnlock = useEffectEvent(applySound);
  useLayoutEffect(() => onUnlock(), [unlocked]);

  // Tap to pause and resume (§5.1.1). What a pause stops on the card on screen: the pooled
  // original, and the fix clip of a fixed card (CardReveal's, found by its test id).
  const playTargets = () => {
    const original = slots[active % POOL_SIZE] === active ? videos[active % POOL_SIZE] : null;
    const fix = scroller.current?.querySelector<HTMLVideoElement>(`article[data-index="${active}"] [data-testid="fix-clip"]`);
    return { original, fix: fix ?? null };
  };
  // The first tap only turns sound on (the unlock) and keeps playing. Later taps on the video
  // toggle it; taps on buttons and links do not.
  const tapped = useRef(false);
  const onTap = (e: React.MouseEvent) => {
    const { original, fix } = playTargets();
    // A tap on a button doesn't use up the first tap.
    if ((e.target as Element).closest("button, a, input, select, textarea, [role=button]")) {
      applySound();
      return;
    }
    const first = !tapped.current;
    tapped.current = true;
    if (first || (!original && !fix)) {
      applySound();
      return;
    }
    if (pausedRef.current) {
      // A fix clip mid-play resumes; otherwise the original, unless it has ended (stamp phase).
      if (fix?.dataset.phase === "fix") fix.play().catch(() => {});
      else if (original && !original.ended) play(original);
    } else {
      original?.pause();
      fix?.pause();
    }
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  // Below the demo banner (26px, sticky at the top) so it doesn't cover the top of the card.
  const frame = `fixed inset-x-0 bottom-16 mx-auto max-w-md bg-black ${useDemoMode() ? "top-[26px]" : "top-0"}`;

  if (reports === undefined) {
    return <FeedMessage frame={frame}>Loading…</FeedMessage>;
  }
  if (count === 0) {
    return <FeedMessage frame={frame}>Nothing on the feed yet. Post the first problem.</FeedMessage>;
  }

  return (
    <div
      ref={scroller}
      // A first swipe flips the unlock, but iOS doesn't count a swipe as a gesture. A later tap does.
      onClick={onTap}
      className={`${frame} snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
    >
      <RevealPausedContext.Provider value={paused}>
        {reports.map((report, k) => (
          <FeedCard
            key={report._id}
            report={report}
            index={k}
            active={k === active}
            near={Math.abs(k - active) <= 1}
            video={slots.includes(k) ? videos[k % POOL_SIZE] : null}
          />
        ))}
        {paused && <PausedIcon top={`${active * 100}%`} />}
        {slots.map((k, slot) => (
          <video
            key={slot}
            ref={videoRefs[slot]}
            data-report-id={k === null ? undefined : reports[k]._id}
            aria-hidden="true"
            playsInline
            muted
            className={`pointer-events-none absolute inset-x-0 z-[1] h-full w-full object-cover ${k === null ? "hidden" : ""}`}
            style={{ top: `${(k ?? 0) * 100}%` }}
          />
        ))}
      </RevealPausedContext.Provider>
    </div>
  );
}

// If iOS refuses unmuted playback (no tap yet on this element), play muted instead of not at all.
function play(el: HTMLVideoElement) {
  el.play().catch(() => {
    if (el.muted) return;
    el.muted = true;
    el.play().catch(() => {});
  });
}

/**
 * Freezes the feed's order on first load so cards don't move under the user's finger
 * (§5.1.2), while each card still shows its live data (counts, status). `pinned` goes first
 * (undefined while it loads, null for none). A card that drops out of the live top 50 keeps
 * its last copy rather than vanishing. A report that turns public later is added at the end.
 */
export function useFeedSnapshot(
  live: PublicReport[] | undefined,
  pinned: PublicReport | null | undefined,
): PublicReport[] | undefined {
  const [snapshot, setSnapshot] = useState<PublicReport[] | null>(null);
  const latest = useMemo(() => {
    const byId = new Map((live ?? []).map((r) => [r._id, r]));
    if (pinned && !byId.has(pinned._id)) byId.set(pinned._id, pinned);
    return byId;
  }, [live, pinned]);

  if (snapshot === null) {
    if (live === undefined || pinned === undefined) return undefined;
    const order = pinned ? [pinned, ...live.filter((r) => r._id !== pinned._id)] : live;
    setSnapshot(order);
    return order;
  }
  // A report approved after the feed opened (a poll brings it in) joins at the end, so nothing
  // shifts under the user's finger. Reopening the feed puts it where its activity says.
  const seen = new Set(snapshot.map((r) => r._id));
  const arrivals = (live ?? []).filter((r) => !seen.has(r._id));
  return [...snapshot.map((r) => latest.get(r._id) ?? r), ...arrivals];
}

function FeedMessage({ frame, children }: { frame: string; children: string }) {
  return (
    <main className={`${frame} flex items-center justify-center p-6 text-center font-bold text-white/80`}>
      {children}
    </main>
  );
}
