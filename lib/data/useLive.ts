"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeToMutations } from "./api";

// Live data by polling (§1.1.1), standing in for M0's useQuery subscriptions:
//
//   const report = useLive(token ? `report:${reportId}` : null,
//     (signal) => query<OwnerReport>("/api/posts/mine", { reportId }, { signal }),
//     { intervalMs: LIVE_STATUS_MS });
//
// Like useQuery it returns undefined while loading, and a null key is useQuery's "skip". The
// key names what's being fetched: when it changes, the hook drops the old value and fetches
// anew. It refetches every `intervalMs` while the tab is visible, when the window regains focus
// or the tab becomes visible, and right after any `mutate()` from lib/data/api.ts.
//
// A tick, focus or visibility change while a request is still out waits for it rather than
// cancelling it, so a link slower than `intervalMs` still loads. A mutate() does cancel it,
// since that response may predate the write. The newest request wins, so a slow response
// never overwrites a fresher one. A response equal
// to the current value keeps the same object, so a poll that changes nothing re-renders nothing.
// A failed fetch keeps the last value and tries again on the next trigger: HTTP polling drops
// requests a websocket wouldn't, and a screen shouldn't blank or crash on one.

/** Status screens: Checking…, the fix verdict. */
export const LIVE_STATUS_MS = 2_000;
/** Lists: the feed, the map, the Me page. */
export const LIVE_LIST_MS = 10_000;

export type LiveFetcher<T> = (signal: AbortSignal) => Promise<T>;

export function useLive<T>(
  key: string | null,
  fetcher: LiveFetcher<T>,
  { intervalMs = LIVE_LIST_MS }: { intervalMs?: number } = {},
): T | undefined {
  // The value is stored with its key, so a key change reads as loading without a reset effect.
  const [state, setState] = useState<{ key: string; value: T; json: string } | null>(null);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (key === null) return;
    let latest = 0;
    let controller: AbortController | null = null;
    let inFlight = false;
    let disposed = false;

    async function refetch() {
      const id = ++latest;
      controller?.abort();
      const current = (controller = new AbortController());
      inFlight = true;
      try {
        const value = await fetcherRef.current(current.signal);
        if (disposed || id !== latest) return;
        const json = JSON.stringify(value) ?? "undefined";
        setState((prev) => (prev && prev.key === key && prev.json === json ? prev : { key: key!, value, json }));
      } catch (error) {
        if (disposed || id !== latest || current.signal.aborted) return;
        console.warn(`useLive(${key}): fetch failed, keeping the last value`, error);
      } finally {
        if (id === latest) inFlight = false;
      }
    }

    // Ticks, focus and visibility: only when nothing is out already (see above).
    const poll = () => {
      if (!inFlight && document.visibilityState !== "hidden") void refetch();
    };
    void refetch();
    const timer = setInterval(poll, intervalMs);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    const unsubscribe = subscribeToMutations(refetch);
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
      unsubscribe();
    };
  }, [key, intervalMs]);

  return state && state.key === key ? state.value : undefined;
}
