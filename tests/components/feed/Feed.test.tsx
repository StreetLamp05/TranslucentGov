// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import Feed from "../../../components/feed/Feed";
import type { FeedSlotProps } from "../../../components/feed/FeedCard";
import type { PublicReport } from "../../../server/lib/publicReport";
import { SoundProvider } from "../../../lib/hooks/sound";

// The feed polls two reads (US37): the list ("feed") and a deep link's report ("feed:<id>", or
// no key when there is none). The mock hands out what the test set, and records the keys.
const data: { feed: PublicReport[] | undefined; pinned: PublicReport | null | undefined } = {
  feed: undefined,
  pinned: undefined,
};
const keys: (string | null)[] = [];
vi.mock("../../../lib/data/useLive", () => ({
  useLive: (key: string | null) => {
    keys.push(key);
    return key === "feed" ? data.feed : key === null ? undefined : data.pinned;
  },
}));

// The rail slot (US18) shows what it's given, so the tests can see live data and state reach the card.
vi.mock("../../../components/feed/CardRail", () => ({
  default: ({ report, active, near }: FeedSlotProps) => (
    <span data-testid={`rail-${report._id}`} data-active={String(active)} data-near={String(near)}>
      {report.meTooCount}
    </span>
  ),
}));

function report(id: string, overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: id,
    _creationTime: 1,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
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
beforeEach(() => {
  play.mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  play.mockReset();
  data.feed = undefined;
  data.pinned = undefined;
  window.sessionStorage.clear();
});

const renderFeed = (firstId?: string) =>
  render(
    <SoundProvider>
      <Feed firstId={firstId} />
    </SoundProvider>,
  );
const cardOrder = () => [...document.querySelectorAll("article")].map((a) => a.dataset.reportId);
const videoFor = (id: string) => document.querySelector<HTMLVideoElement>(`video[data-report-id="${id}"]`)!;
const rail = (id: string) => document.querySelector<HTMLElement>(`[data-testid="rail-${id}"]`)!;
const tapAnywhere = () =>
  act(() => {
    fireEvent.touchEnd(document.body);
  });
const tapCard = () =>
  act(() => {
    fireEvent.click(document.querySelector("article")!);
  });

describe("sound", () => {
  test("an audioMuted card stays muted after the sound unlock; a normal card unmutes", () => {
    data.feed = [report("muted", { audioMuted: true, lastActivityAt: 2 }), report("loud")];
    renderFeed();
    expect(videoFor("muted").muted).toBe(true);
    expect(videoFor("loud").muted).toBe(true);

    act(() => {
      fireEvent.touchEnd(document.body);
    });
    expect(videoFor("muted").muted).toBe(true);
    expect(videoFor("loud").muted).toBe(false);

    // The tap fallback re-applies the same rule.
    tapCard();
    expect(videoFor("muted").muted).toBe(true);
  });

  test("the unlock plays every pooled element once, including the empty one card 2 will use", () => {
    data.feed = ["a", "b", "c", "d"].map((id, i) => report(id, { lastActivityAt: 10 - i }));
    renderFeed();
    play.mockClear();
    tapAnywhere();
    const videos = [...document.querySelectorAll("video")];
    expect(videos.filter((v) => !v.getAttribute("src"))).toHaveLength(1);
    expect(new Set(play.mock.contexts)).toEqual(new Set(videos));
  });

  describe("a tap never restarts the card on screen", () => {
    const setup = () => {
      data.feed = [report("a", { lastActivityAt: 2 }), report("b")];
      renderFeed();
      tapAnywhere();
      play.mockClear();
      return videoFor("a");
    };
    const playsOf = (el: HTMLVideoElement) => play.mock.contexts.filter((c) => c === el).length;

    test("while it's playing", () => {
      const a = setup();
      vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
      tapCard();
      expect(playsOf(a)).toBe(0);
    });

    test("after CardReveal takes it over (loop off), e.g. paused for the stamp", () => {
      const a = setup();
      a.loop = false;
      tapCard();
      expect(playsOf(a)).toBe(0);
    });

    test("but resumes it if it's paused while the pool owns it (iOS refused to play)", () => {
      const a = setup();
      tapCard();
      expect(playsOf(a)).toBe(1);
    });
  });
});

describe("order", () => {
  test("a live count change doesn't reorder the rendered list; remount re-sorts", () => {
    data.feed = [report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 }), report("c", { lastActivityAt: 10 })];
    const { rerender, unmount, getByTestId } = renderFeed();
    expect(cardOrder()).toEqual(["a", "b", "c"]);

    // A me-too bumps c to the top of the live query.
    data.feed = [report("c", { lastActivityAt: 40, meTooCount: 5 }), report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    rerender(
      <SoundProvider>
        <Feed />
      </SoundProvider>,
    );
    expect(cardOrder()).toEqual(["a", "b", "c"]);
    expect(getByTestId("rail-c").textContent).toBe("5");

    unmount();
    renderFeed();
    expect(cardOrder()).toEqual(["c", "a", "b"]);
  });

  test("a report approved after the feed opened joins at the end, without moving the others", () => {
    data.feed = [report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    const { rerender, unmount } = renderFeed();
    data.feed = [report("n", { lastActivityAt: 50 }), report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    rerender(
      <SoundProvider>
        <Feed />
      </SoundProvider>,
    );
    expect(cardOrder()).toEqual(["a", "b", "n"]);

    unmount();
    renderFeed();
    expect(cardOrder()).toEqual(["n", "a", "b"]);
  });

  test("reads the list, and a deep link's report only when there is one", () => {
    data.feed = [report("a")];
    keys.length = 0;
    const { unmount } = renderFeed();
    expect(new Set(keys)).toEqual(new Set(["feed", null]));
    unmount();

    keys.length = 0;
    data.pinned = null;
    render(
      <SoundProvider>
        <Feed firstId="deep" />
      </SoundProvider>,
    );
    expect(new Set(keys)).toEqual(new Set(["feed", "feed:deep"]));
  });

  test("a card that drops out of the live feed keeps its place", () => {
    data.feed = [report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    const { rerender } = renderFeed();
    data.feed = [report("a", { lastActivityAt: 30 })];
    rerender(
      <SoundProvider>
        <Feed />
      </SoundProvider>,
    );
    expect(cardOrder()).toEqual(["a", "b"]);
  });

  test("/?report=<id> opens with that card first, even when it's outside the top 50", () => {
    data.feed = [report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    data.pinned = report("b", { lastActivityAt: 20 });
    renderFeed("b");
    expect(cardOrder()).toEqual(["b", "a"]);
    cleanup();

    data.pinned = report("old", { lastActivityAt: 1 });
    renderFeed("old");
    expect(cardOrder()).toEqual(["old", "a", "b"]);
  });

  test("waits for the deep-linked report, and falls back to the plain order when it isn't public", () => {
    data.feed = [report("a", { lastActivityAt: 30 }), report("b", { lastActivityAt: 20 })];
    data.pinned = undefined;
    const { rerender } = renderFeed("held");
    expect(cardOrder()).toEqual([]);

    data.pinned = null;
    rerender(
      <SoundProvider>
        <Feed firstId="held" />
      </SoundProvider>,
    );
    expect(cardOrder()).toEqual(["a", "b"]);
  });
});

describe("video pool", () => {
  test("loads only the card on screen and the next one, and plays only the one on screen", () => {
    data.feed = ["a", "b", "c", "d"].map((id, i) => report(id, { lastActivityAt: 10 - i }));
    renderFeed();
    const videos = [...document.querySelectorAll("video")];
    expect(videos).toHaveLength(3);
    expect(videos.map((v) => v.getAttribute("src")).filter(Boolean)).toEqual([
      "https://files.test/a.mp4",
      "https://files.test/b.mp4",
    ]);
    expect(play.mock.contexts).toEqual([videoFor("a")]);
    expect(videoFor("a").getAttribute("poster")).toBe("https://files.test/a.jpg");
  });

  test("slots learn which card is on screen and which are near it", () => {
    data.feed = ["a", "b", "c"].map((id, i) => report(id, { lastActivityAt: 10 - i }));
    renderFeed();
    expect(["a", "b", "c"].map((id) => rail(id).dataset.active)).toEqual(["true", "false", "false"]);
    expect(["a", "b", "c"].map((id) => rail(id).dataset.near)).toEqual(["true", "true", "false"]);
  });
});

describe("active card", () => {
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const entry = (index: number, ratio: number) =>
    ({ target: document.querySelectorAll("article")[index], isIntersecting: ratio > 0, intersectionRatio: ratio }) as unknown as IntersectionObserverEntry;

  test("a card leaving the screen (still intersecting, below 60%) doesn't steal the active slot", () => {
    data.feed = ["a", "b", "c"].map((id, i) => report(id, { lastActivityAt: 10 - i }));
    renderFeed();
    act(() => observed([entry(1, 0.65), entry(0, 0.35)], {} as IntersectionObserver));
    expect(rail("b").dataset.active).toBe("true");
    expect(rail("a").dataset.active).toBe("false");
    expect(rail("c").dataset.near).toBe("true");
  });
});

test("in demo mode the feed starts below the demo banner", () => {
  window.sessionStorage.setItem("govtok.demoMode", "1");
  data.feed = [report("a")];
  renderFeed();
  expect(document.querySelector("article")!.parentElement!.className).toContain("top-[26px]");
});
