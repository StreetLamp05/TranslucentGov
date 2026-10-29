// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mutate } from "@/lib/data/api";
import { useLive } from "@/lib/data/useLive";

// Polling stands in for Convex subscriptions (§1.1.1). Fake timers drive the interval; the
// fetchers are plain mocks, so only the hook's scheduling is under test.

// Lets resolved fetcher promises land in state.
const flush = () => act(async () => {});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLive", () => {
  test("is undefined while loading, then the fetched value", async () => {
    const pending = deferred<string>();
    const { result } = renderHook(() => useLive("k", () => pending.promise, { intervalMs: 1000 }));
    expect(result.current).toBeUndefined();

    pending.resolve("hello");
    await flush();
    expect(result.current).toBe("hello");
  });

  test("a null key skips: no fetch, undefined", async () => {
    const fetcher = vi.fn(async () => 1);
    const { result } = renderHook(() => useLive(null, fetcher, { intervalMs: 1000 }));
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  test("refetches every intervalMs and picks up new data without a remount", async () => {
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    const { result } = renderHook(() => useLive("k", fetcher, { intervalMs: 2000 }));
    await flush();
    expect(result.current).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(1999));
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(2);

    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(result.current).toBe(4);
  });

  test("doesn't poll while the tab is hidden, and refetches when it's visible again", async () => {
    const fetcher = vi.fn(async () => "x");
    renderHook(() => useLive("k", fetcher, { intervalMs: 1000 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(fetcher).toHaveBeenCalledTimes(1);

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("refetches on window focus", async () => {
    const fetcher = vi.fn(async () => "x");
    renderHook(() => useLive("k", fetcher, { intervalMs: 60_000 }));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("refetches right after any mutate(), without waiting for the interval", async () => {
    let count = 0;
    const fetcher = vi.fn(async () => count);
    const { result } = renderHook(() => useLive("count", fetcher, { intervalMs: 60_000 }));
    await flush();
    expect(result.current).toBe(0);

    count = 1;
    await act(async () => {
      await mutate("/api/me-too", { reportId: "r1" });
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(1);
  });

  test("refetches after a mutate() that fails too", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Nope" }, { status: 400 }));
    const fetcher = vi.fn(async () => "x");
    renderHook(() => useLive("k", fetcher, { intervalMs: 60_000 }));
    await flush();

    await act(async () => {
      await mutate("/api/me-too", {}).catch(() => {});
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("the newest request wins over a slower, older one", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useLive("k", fetcher, { intervalMs: 60_000 }));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    second.resolve("new");
    await flush();
    first.resolve("old");
    await flush();
    expect(result.current).toBe("new");
    // The superseded request was told to stop.
    expect((fetcher.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  });

  test("a poll with unchanged data keeps the same object", async () => {
    const fetcher = vi.fn(async () => ({ items: [1, 2] }));
    const { result } = renderHook(() => useLive("k", fetcher, { intervalMs: 1000 }));
    await flush();
    const before = result.current;

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(before);
  });

  test("a failed poll keeps the last value, and the next one recovers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce("first")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("third");
    const { result } = renderHook(() => useLive("k", fetcher, { intervalMs: 1000 }));
    await flush();
    expect(result.current).toBe("first");

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current).toBe("first");
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current).toBe("third");
  });

  test("a new key reads as loading until its own data arrives", async () => {
    const pending = deferred<string>();
    const fetcher = vi.fn().mockResolvedValueOnce("for a").mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(({ key }) => useLive(key, fetcher, { intervalMs: 60_000 }), {
      initialProps: { key: "a" },
    });
    await flush();
    expect(result.current).toBe("for a");

    rerender({ key: "b" });
    expect(result.current).toBeUndefined();
    pending.resolve("for b");
    await flush();
    expect(result.current).toBe("for b");
  });

  test("uses the latest fetcher without refetching on every render", async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLive("k", async () => value, { intervalMs: 1000 }),
      { initialProps: { value: "one" } },
    );
    await flush();
    rerender({ value: "two" });
    expect(result.current).toBe("one");

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(result.current).toBe("two");
  });

  test("stops polling and listening once unmounted", async () => {
    const fetcher = vi.fn(async () => "x");
    const { unmount } = renderHook(() => useLive("k", fetcher, { intervalMs: 1000 }));
    await flush();
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      window.dispatchEvent(new Event("focus"));
      await mutate("/api/x", {});
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
