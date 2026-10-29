// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CardReveal from "../../../components/feed/CardReveal";
import Feed from "../../../components/feed/Feed";
import { recordRevealViewOnce, STAMP_MS } from "../../../components/RevealPlayer";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicReport } from "../../../server/lib/publicReport";

const record = vi.fn();
let feed: PublicReport[] = [];
vi.mock("../../../lib/data/api", () => ({ mutate: (...args: unknown[]) => record(...args) }));
vi.mock("../../../lib/data/useLive", () => ({ useLive: (key: string | null) => (key === "feed" ? feed : undefined) }));
// The Me too rail (US18) has its own tests.
vi.mock("../../../components/feed/CardRail", () => ({ default: () => null }));

const CLIP = "https://files.test/r1.mp4";

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: "r1" as Id<"reports">,
    _creationTime: 0,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    owner: "city",
    agency: "Mableton Sanitation",
    title: "Overflowing trash can",
    status: "fixed",
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: 0,
    fixedAt: 86_400_000,
    fixedByKind: "fixer",
    fixedByLabel: "Mableton Sanitation",
    clipUrl: CLIP,
    frameUrls: [],
    fixUrl: "https://files.test/r1-fix.mp4",
    ...overrides,
  } as PublicReport;
}

function pooled(): HTMLVideoElement {
  const el = document.createElement("video");
  el.setAttribute("src", CLIP);
  return el;
}

const ended = (el: HTMLMediaElement) => act(() => void el.dispatchEvent(new Event("ended")));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const show = (r: PublicReport, video: HTMLVideoElement | null) =>
  render(<CardReveal report={r} active near video={video} />);

beforeEach(() => {
  sessionStorage.clear();
  record.mockReset();
  record.mockResolvedValue(null);
  vi.useFakeTimers();
  // Like a browser, playing fires "play" on the element.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CardReveal", () => {
  test("open cards get no reveal", () => {
    show(report({ status: "open", fixedAt: undefined, fixedByKind: undefined, fixedByLabel: undefined }), pooled());
    expect(screen.queryByTestId("fix-clip")).toBeNull();
  });

  test("records one reveal view per report per session, when the stamp first plays", () => {
    const video = pooled();
    const view = show(report(), video);
    expect(record).not.toHaveBeenCalled(); // not before the stamp

    ended(video);
    expect(screen.getByTestId("fixed-stamp")).toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith("/api/reveal", { reportId: "r1" });

    // Later loops don't count.
    wait(STAMP_MS);
    ended(screen.getByTestId("fix-clip") as HTMLVideoElement);
    ended(video);
    expect(screen.getByTestId("fixed-stamp")).toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);

    // Nor does scrolling away and back (a remount), within the session.
    view.unmount();
    const again = pooled();
    show(report(), again);
    ended(again);
    expect(record).toHaveBeenCalledTimes(1);

    // Another fixed report counts on its own.
    cleanup();
    const other = pooled();
    show(report({ _id: "r2" as Id<"reports"> }), other);
    ended(other);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith("/api/reveal", { reportId: "r2" });
  });
});

// Inside the real feed, whose pool points its element at the card after RevealPlayer's effect
// has run (parent effects run after child effects) and turns loop back on.
describe("in the feed", () => {
  test("a fixed first card takes over the pooled element and reaches the stamp", () => {
    feed = [report({ _id: "f1" as Id<"reports"> }), report({ _id: "f2" as Id<"reports">, status: "open", fixedAt: undefined, fixedByKind: undefined })];
    const view = render(<Feed />);
    const pooledVideo = view.container.querySelector('video[data-report-id="f1"]') as HTMLVideoElement;
    expect(pooledVideo.getAttribute("src")).toBe(CLIP);
    expect(pooledVideo.loop).toBe(false);
    ended(pooledVideo);
    expect(screen.getByTestId("fixed-stamp")).toBeTruthy();
    expect(record).toHaveBeenCalledWith("/api/reveal", { reportId: "f1" });
    // The open card's element still loops.
    expect((view.container.querySelector('video[data-report-id="f2"]') as HTMLVideoElement).loop).toBe(true);
  });
});

describe("recordRevealViewOnce", () => {
  test("a failed call is retried on the next stamp", async () => {
    const id = "r3" as Id<"reports">;
    const failing = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    recordRevealViewOnce(id, failing);
    await act(async () => {}); // let the rejection land
    recordRevealViewOnce(id, failing);
    recordRevealViewOnce(id, failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  test("still once per report when sessionStorage reads but won't write (full quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const call = vi.fn().mockResolvedValue(null);
    recordRevealViewOnce("r6" as Id<"reports">, call);
    recordRevealViewOnce("r6" as Id<"reports">, call);
    expect(call).toHaveBeenCalledTimes(1);
  });

  test("still once per report when sessionStorage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const call = vi.fn().mockResolvedValue(null);
    recordRevealViewOnce("r4" as Id<"reports">, call);
    recordRevealViewOnce("r4" as Id<"reports">, call);
    recordRevealViewOnce("r5" as Id<"reports">, call);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
