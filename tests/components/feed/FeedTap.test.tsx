// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Feed from "../../../components/feed/Feed";
import type { PublicReport } from "../../../server/lib/publicReport";
import { SoundProvider } from "../../../lib/hooks/sound";

const data: { feed: PublicReport[] } = { feed: [] };
vi.mock("../../../lib/data/useLive", () => ({
  useLive: (key: string | null) => (key === "feed" ? data.feed : undefined),
}));
vi.mock("../../../components/feed/CardRail", () => ({ default: () => null }));
vi.mock("../../../components/feed/CardActions", () => ({ default: () => null }));

function report(id: string, overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: id,
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8,
    lng: -84.5,
    title: `Report ${id}`,
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 1,
    revealViews: 0,
    createdAt: 1,
    clipUrl: `https://files.test/${id}.mp4`,
    frameUrls: [`https://files.test/${id}.jpg`],
    fixUrl: null,
    ...overrides,
  } as PublicReport;
}

const play = vi.fn();
const pause = vi.fn();
beforeEach(() => {
  play.mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  play.mockReset();
  pause.mockReset();
});

const videoFor = (id: string) => document.querySelector<HTMLVideoElement>(`video[data-report-id="${id}"]`)!;
const icon = () => document.querySelector('[data-testid="paused-icon"]');
const tap = (el: Element) =>
  act(() => {
    fireEvent.touchEnd(el);
    fireEvent.click(el);
  });
const cardTap = () => tap(document.querySelector("article")!);
const mount = () => {
  data.feed = [report("a", { lastActivityAt: 2 }), report("b")];
  render(
    <SoundProvider>
      <Feed />
    </SoundProvider>,
  );
  pause.mockClear();
};
const playsOf = (el: HTMLVideoElement) => play.mock.contexts.filter((c) => c === el).length;
const pausesOf = (el: HTMLVideoElement) => pause.mock.contexts.filter((c) => c === el).length;

describe("tap to pause", () => {
  test("the first tap unmutes and keeps playing; later taps pause and resume", () => {
    mount();
    const a = videoFor("a");
    expect(a.muted).toBe(true);
    cardTap();
    expect(a.muted).toBe(false);
    expect(icon()).toBeNull();
    expect(pausesOf(a)).toBe(0);

    play.mockClear();
    cardTap();
    expect(pausesOf(a)).toBe(1);
    expect(icon()).not.toBeNull();

    cardTap();
    expect(playsOf(a)).toBe(1);
    expect(icon()).toBeNull();
  });

  test("taps on buttons never toggle playback", () => {
    mount();
    cardTap();
    const button = document.createElement("button");
    document.querySelector("article")!.appendChild(button);
    tap(button);
    expect(icon()).toBeNull();
    expect(pausesOf(videoFor("a"))).toBe(0);

    cardTap();
    expect(icon()).not.toBeNull();
    tap(button);
    expect(icon()).not.toBeNull();
  });

  test("a paused card stays paused through a stray tap-resume by the pool, and audioMuted stays muted", () => {
    data.feed = [report("a", { audioMuted: true })];
    render(
      <SoundProvider>
        <Feed />
      </SoundProvider>,
    );
    pause.mockClear();
    cardTap();
    cardTap();
    expect(videoFor("a").muted).toBe(true);
    expect(icon()).not.toBeNull();
    cardTap();
    expect(videoFor("a").muted).toBe(true);
  });

  describe("swiping", () => {
    let observed: IntersectionObserverCallback;
    beforeEach(() => {
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(callback: IntersectionObserverCallback) {
            observed = callback;
          }
          observe() {}
          disconnect() {}
        },
      );
    });
    const show = (index: number) =>
      act(() =>
        observed(
          [{ target: document.querySelectorAll("article")[index], isIntersecting: true, intersectionRatio: 0.9 } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );

    test("the next card plays, and coming back to a paused card resumes it", () => {
      mount();
      cardTap();
      cardTap();
      expect(icon()).not.toBeNull();

      play.mockClear();
      show(1);
      expect(icon()).toBeNull();
      expect(playsOf(videoFor("b"))).toBe(1);

      play.mockClear();
      show(0);
      expect(icon()).toBeNull();
      expect(playsOf(videoFor("a"))).toBe(1);
    });
  });
});

describe("a fixed card's reveal", () => {
  const fixed = () => report("a", { status: "fixed", fixUrl: "https://files.test/a-fix.mp4", fixedAt: 5, lastActivityAt: 2 });
  const mountFixed = () => {
    vi.useFakeTimers();
    // Playing, as far as the player's tap handler can tell (jsdom reports every element paused).
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
    data.feed = [fixed(), report("b")];
    render(
      <SoundProvider>
        <Feed />
      </SoundProvider>,
    );
    cardTap(); // the first tap: sound on
    play.mockClear();
    pause.mockClear();
  };
  afterEach(() => vi.useRealTimers());
  const fix = () => document.querySelector<HTMLVideoElement>('[data-testid="fix-clip"]')!;
  const phase = () => fix().dataset.phase;
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const ended = (el: HTMLVideoElement) => act(() => void el.dispatchEvent(new Event("ended")));

  test("pausing mid-original stops it and resuming plays it again", () => {
    mountFixed();
    const a = videoFor("a");
    cardTap();
    expect(pausesOf(a)).toBe(1);
    cardTap();
    expect(playsOf(a)).toBe(1);
    expect(a.muted).toBe(false);
  });

  test("pausing mid-stamp holds the stamp, and resuming finishes it and plays the fix", () => {
    mountFixed();
    ended(videoFor("a"));
    expect(phase()).toBe("stamp");
    wait(300);
    cardTap();
    play.mockClear(); // the pausing tap primes the fix clip for iOS (play, then pause)
    wait(5000);
    expect(phase()).toBe("stamp");
    expect(playsOf(fix())).toBe(0);

    cardTap();
    wait(399);
    expect(phase()).toBe("stamp");
    wait(1);
    expect(phase()).toBe("fix");
    expect(playsOf(fix())).toBe(1);
    expect(icon()).toBeNull();
  });

  test("pausing mid-fix pauses the fix clip, and resuming plays it from where it was", () => {
    mountFixed();
    ended(videoFor("a"));
    wait(700);
    expect(phase()).toBe("fix");
    play.mockClear();
    cardTap();
    expect(pausesOf(fix())).toBe(1);
    expect(phase()).toBe("fix");
    cardTap();
    expect(playsOf(fix())).toBe(1);
    expect(playsOf(videoFor("a"))).toBe(0);
  });

  test("a button tap while paused leaves it paused and the original muted state alone", () => {
    mountFixed();
    const a = videoFor("a");
    cardTap();
    play.mockClear();
    const button = document.createElement("button");
    document.querySelector("article")!.appendChild(button);
    tap(button);
    expect(playsOf(a)).toBe(0);
    expect(icon()).not.toBeNull();
    expect(a.muted).toBe(false);
  });
});

test("a button tap doesn't use up the first tap", () => {
  mount();
  const button = document.createElement("button");
  document.querySelector("article")!.appendChild(button);
  tap(button);
  expect(icon()).toBeNull();
  cardTap();
  expect(icon()).toBeNull();
  cardTap();
  expect(icon()).not.toBeNull();
});
