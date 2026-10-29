// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import RevealPlayer, { PHOTO_HOLD_MS, STAMP_MS, stampText, type RevealReport } from "../../components/RevealPlayer";
import { SoundProvider } from "../../lib/hooks/sound";

const DAY_MS = 86_400_000;
const CLIP = "https://files.test/r1.mp4";
const FIX = "https://files.test/r1-fix.mp4";

function report(overrides: Partial<RevealReport> = {}): RevealReport {
  return {
    _id: "r1",
    clipUrl: CLIP,
    frameUrls: ["https://files.test/r1.jpg"],
    fixUrl: FIX,
    audioMuted: false,
    createdAt: 0,
    fixedAt: 9 * DAY_MS,
    fixedByKind: "fixer",
    fixedByLabel: "Mableton Sanitation",
    agency: "Mableton Sanitation",
    owner: "city",
    ...overrides,
  };
}

// The pooled element, already pointed at the card's clip and started by the pool.
function pooled(): HTMLVideoElement {
  const el = document.createElement("video");
  el.setAttribute("src", CLIP);
  el.loop = true;
  return el;
}

// Each play() call, with whether the element was muted at that moment.
let plays: { el: HTMLMediaElement; muted: boolean }[] = [];
beforeEach(() => {
  plays = [];
  vi.useFakeTimers();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    plays.push({ el: this, muted: this.muted });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Slot = { active?: boolean; near?: boolean; video?: HTMLVideoElement | null; onStamp?: () => void };
const player = (r: RevealReport, slot: Slot) => (
  <SoundProvider>
    <RevealPlayer report={r} active={slot.active ?? true} near={slot.near ?? true} video={slot.video ?? null} onStamp={slot.onStamp} />
  </SoundProvider>
);
const show = (r: RevealReport, slot: Slot = {}) => render(player(r, slot));

const fixClip = () => screen.getByTestId("fix-clip") as HTMLVideoElement;
const phase = () => fixClip().dataset.phase;
const stamp = () => screen.queryByTestId("fixed-stamp");
const ended = (el: HTMLVideoElement) => act(() => void el.dispatchEvent(new Event("ended")));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("state machine", () => {
  test("original → stamp → fix → original, around again", () => {
    const video = pooled();
    const onStamp = vi.fn();
    show(report(), { video, onStamp });

    // The pool already started the original; the player takes it over.
    expect(phase()).toBe("original");
    expect(video.loop).toBe(false);
    expect(fixClip().className).toContain("invisible");
    expect(stamp()).toBeNull();
    expect(plays).toHaveLength(0);

    ended(video);
    expect(phase()).toBe("stamp");
    expect(stamp()).not.toBeNull();
    expect(onStamp).toHaveBeenCalledTimes(1);

    wait(STAMP_MS - 1);
    expect(phase()).toBe("stamp");
    wait(1);
    expect(phase()).toBe("fix");
    expect(stamp()).toBeNull();
    expect(fixClip().className).not.toContain("invisible");
    expect(plays.at(-1)?.el).toBe(fixClip());

    video.currentTime = 4;
    ended(fixClip());
    expect(phase()).toBe("original");
    expect(fixClip().className).toContain("invisible");
    // The player restarts the original itself from the second pass on.
    expect(video.currentTime).toBe(0);
    expect(plays.at(-1)?.el).toBe(video);

    ended(video);
    expect(phase()).toBe("stamp");
    expect(onStamp).toHaveBeenCalledTimes(2);
  });

  test("a slideshow (no clip) holds, then stamps, then plays the fix", () => {
    const onStamp = vi.fn();
    show(report({ clipUrl: null }), { video: null, onStamp });

    wait(PHOTO_HOLD_MS - 1);
    expect(phase()).toBe("original");
    wait(1);
    expect(phase()).toBe("stamp");
    expect(onStamp).toHaveBeenCalledTimes(1);
    wait(STAMP_MS);
    expect(phase()).toBe("fix");
    ended(fixClip());
    expect(phase()).toBe("original");
    wait(PHOTO_HOLD_MS);
    expect(phase()).toBe("stamp");
  });

  test("a fix clip that fails to play goes back to the original", async () => {
    const video = pooled();
    show(report(), { video });
    ended(video);
    wait(STAMP_MS);
    expect(phase()).toBe("fix");
    act(() => void fixClip().dispatchEvent(new Event("error")));
    expect(phase()).toBe("original");
  });

  test("an original that fails to load holds on its poster, then still reveals the fix", () => {
    const video = pooled();
    show(report(), { video });
    act(() => void video.dispatchEvent(new Event("error")));
    wait(PHOTO_HOLD_MS - 1);
    expect(phase()).toBe("original");
    wait(1);
    expect(phase()).toBe("stamp");
    wait(STAMP_MS);
    expect(phase()).toBe("fix");

    // Later passes: the element still has its error, so it holds again.
    Object.defineProperty(video, "error", { configurable: true, value: { code: 4 } });
    ended(fixClip());
    expect(phase()).toBe("original");
    wait(PHOTO_HOLD_MS);
    expect(phase()).toBe("stamp");
  });

  test("leaving the screen resets to the original and stops the fix clip", () => {
    const video = pooled();
    const view = show(report(), { video });
    ended(video);
    wait(STAMP_MS);
    expect(phase()).toBe("fix");

    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    view.rerender(player(report(), { video, active: false }));
    expect(phase()).toBe("original");
    expect(pause.mock.contexts).toContain(fixClip());

    // Back on screen: the pool restarts the original, and the player waits for it to end.
    view.rerender(player(report(), { video, active: true }));
    expect(phase()).toBe("original");
    ended(video);
    expect(phase()).toBe("stamp");
  });

  test("an inactive card doesn't advance", () => {
    const onStamp = vi.fn();
    show(report({ clipUrl: null }), { active: false, onStamp });
    wait(PHOTO_HOLD_MS * 3);
    expect(phase()).toBe("original");
    expect(onStamp).not.toHaveBeenCalled();
  });

  test("the fix clip loads only when near", () => {
    const view = show(report(), { active: false, near: false });
    expect(fixClip().getAttribute("src")).toBeNull();
    view.rerender(player(report(), { active: false, near: true }));
    expect(fixClip().getAttribute("src")).toBe(FIX);
  });
});

describe("standalone (the Me page, US24)", () => {
  test("draws and starts its own original, then loops the reveal", () => {
    const view = render(<RevealPlayer report={report()} active standalone />);
    const own = view.container.querySelector(`video[src="${CLIP}"]`) as HTMLVideoElement;
    expect(own).not.toBeNull();
    expect(own.loop).toBe(false);
    expect(plays[0]).toEqual({ el: own, muted: true }); // no sound unlock yet
    ended(own);
    expect(phase()).toBe("stamp");
    wait(STAMP_MS);
    ended(fixClip());
    expect(phase()).toBe("original");
    expect(plays.at(-1)?.el).toBe(own);
  });

  test("a photo post draws its slideshow", () => {
    render(<RevealPlayer report={report({ clipUrl: null })} active standalone />);
    expect(screen.getByTestId("slideshow")).toBeTruthy();
    wait(PHOTO_HOLD_MS);
    expect(phase()).toBe("stamp");
  });
});

describe("stamp text", () => {
  test("a fixer's fix names the org", () => {
    const r = report();
    expect(stampText(r)).toBe("FIXED · 9 days · Fixed by Mableton Sanitation");
    const video = pooled();
    show(r, { video });
    ended(video);
    expect(screen.getByRole("img", { name: "FIXED · 9 days · Fixed by Mableton Sanitation" })).toBe(stamp());
    expect(stamp()?.textContent).toContain("9 days · Fixed by Mableton Sanitation");
  });

  test("a neighbor's fix names the owning agency", () => {
    const r = report({ fixedByKind: "resident", fixedByLabel: "neighbor", owner: "cobb", agency: "Cobb DOT" });
    expect(stampText(r)).toBe("FIXED · 9 days · Fix confirmed by a neighbor · Cobb DOT");
    const video = pooled();
    show(r, { video });
    ended(video);
    expect(screen.getByRole("img", { name: "FIXED · 9 days · Fix confirmed by a neighbor · Cobb DOT" })).toBe(stamp());
  });

  test("same day, one day, and a fix with no fixedAt", () => {
    expect(stampText(report({ fixedAt: DAY_MS - 1 }))).toBe("FIXED · same day · Fixed by Mableton Sanitation");
    expect(stampText(report({ fixedAt: DAY_MS }))).toBe("FIXED · 1 day · Fixed by Mableton Sanitation");
    expect(stampText(report({ fixedAt: undefined }))).toBe("FIXED · Fixed by Mableton Sanitation");
  });
});

describe("the fix clip is always muted", () => {
  test("even after the sound-unlock tap", () => {
    const video = pooled();
    show(report(), { video });
    expect(fixClip().muted).toBe(true);

    // The first tap anywhere unlocks sound for the session (US6).
    fireEvent.pointerUp(window);
    fireEvent.click(window);
    expect(fixClip().muted).toBe(true);

    ended(video);
    wait(STAMP_MS);
    expect(phase()).toBe("fix");
    const fixPlays = plays.filter((p) => p.el === fixClip());
    expect(fixPlays.length).toBeGreaterThan(0);
    expect(fixPlays.every((p) => p.muted)).toBe(true);

    // Someone unmutes it; the next pass mutes it again before playing.
    fixClip().muted = false;
    ended(fixClip());
    ended(video);
    wait(STAMP_MS);
    expect(plays.at(-1)).toEqual({ el: fixClip(), muted: true });
  });
});

test("the stamp lasts about 0.7 s (§5.1.1)", () => {
  expect(STAMP_MS).toBe(700);
});

describe("taps", () => {
  test("never pause the fix clip mid-play", () => {
    const video = pooled();
    show(report(), { video });
    ended(video);
    wait(STAMP_MS);
    expect(phase()).toBe("fix");
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    fireEvent.click(window);
    expect(pause.mock.contexts).not.toContain(fixClip());
    expect(phase()).toBe("fix");
  });

  test("resume an original that autoplay refused, but never during the stamp or the fix", () => {
    const video = pooled(); // paused, not ended: autoplay was refused
    show(report(), { video });
    fireEvent.click(window);
    expect(plays.filter((p) => p.el === video)).toHaveLength(1);

    ended(video);
    fireEvent.click(window); // during the stamp
    wait(STAMP_MS);
    fireEvent.click(window); // during the fix clip
    expect(plays.filter((p) => p.el === video)).toHaveLength(1);
  });
});
