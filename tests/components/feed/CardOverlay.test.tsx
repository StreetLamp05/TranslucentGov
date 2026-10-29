// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import CardOverlay, { statusText } from "../../../components/feed/CardOverlay";
import type { PublicReport } from "../../../server/lib/publicReport";
import { OWNER_CHIP, OWNERS } from "../../../server/lib/routing";

const DAY_MS = 86_400_000;
const CLIP = "https://files.test/r1.mp4";
const SEGMENTS = [
  { start: 0, end: 2, text: "Deep pothole in the right lane." },
  { start: 2, end: 4, text: "Third tire this month." },
];

function report(overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: "r1" as string,
    _creationTime: 0,
    mediaType: "video",
    lat: 33.8187,
    lng: -84.5824,
    street: "Floyd Rd SW at Church St",
    owner: "cobb",
    agency: "Cobb DOT",
    title: "Deep pothole in the right lane",
    status: "open",
    audioMuted: false,
    isSample: false,
    meTooCount: 0,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: Date.now() - 23 * DAY_MS,
    description: "Been here since September.",
    transcript: "Deep pothole in the right lane. Third tire this month.",
    segments: SEGMENTS,
    clipUrl: CLIP,
    frameUrls: ["https://files.test/r1.jpg"],
    fixUrl: null,
    ...overrides,
  } as PublicReport;
}

// A pooled element already pointed at the card's clip, the way Feed sets it up.
function videoAt(src: string | null = CLIP): HTMLVideoElement {
  const el = document.createElement("video");
  if (src) el.setAttribute("src", src);
  return el;
}

function seek(el: HTMLVideoElement, time: number) {
  act(() => {
    el.currentTime = time;
    el.dispatchEvent(new Event("timeupdate"));
  });
}

const show = (r: PublicReport, slot: { active?: boolean; near?: boolean; video?: HTMLVideoElement | null } = {}) =>
  render(<CardOverlay report={r} active={slot.active ?? true} near={slot.near ?? true} video={slot.video ?? null} />);

afterEach(cleanup);

describe("owner chip", () => {
  const agency = { city: "Mableton Sanitation", cobb: "Cobb DOT", utility: "Georgia Power", unknown: "Routing unclear" };

  test.each(OWNERS)("%s shows its own color and agency", (owner) => {
    show(report({ owner, agency: agency[owner] }));
    expect(screen.getByTestId("owner-chip").textContent).toBe(agency[owner]);
    expect(screen.getByTestId("owner-dot").style.background).toBe(hexToRgb(OWNER_CHIP[owner].dot));
  });

  test("the four owners' colors differ", () => {
    expect(new Set(OWNERS.map((o) => OWNER_CHIP[o].dot)).size).toBe(4);
  });
});

describe("status", () => {
  test("open 23 days", () => {
    show(report({ createdAt: Date.now() - 23 * DAY_MS }));
    expect(screen.getByTestId("status").textContent).toBe("Open · 23 days");
  });

  test("fixed 9 days after creation, however long ago that was", () => {
    const createdAt = Date.now() - 40 * DAY_MS;
    show(report({ status: "fixed", createdAt, fixedAt: createdAt + 9 * DAY_MS + 3_600_000 }));
    expect(screen.getByTestId("status").textContent).toBe("Fixed in 9 days");
  });

  test("singular and same-day wording", () => {
    const now = 100 * DAY_MS;
    expect(statusText({ status: "open", createdAt: now - DAY_MS }, now)).toBe("Open · 1 day");
    expect(statusText({ status: "open", createdAt: now - 3_600_000 }, now)).toBe("Open · today");
    expect(statusText({ status: "fixed", createdAt: now, fixedAt: now + DAY_MS }, now)).toBe("Fixed in 1 day");
    expect(statusText({ status: "fixed", createdAt: now, fixedAt: now + 60_000 }, now)).toBe("Fixed same day");
  });
});

describe("captions", () => {
  test("follow the video's currentTime", () => {
    const video = videoAt();
    show(report(), { video });
    seek(video, 0.5);
    expect(screen.getByTestId("caption").textContent).toBe("Deep pothole in the right lane.");
    seek(video, 3);
    expect(screen.getByTestId("caption").textContent).toBe("Third tire this month.");
    seek(video, 5);
    expect(screen.queryByTestId("caption")).toBeNull();
  });

  test("none while the card isn't on screen", () => {
    const video = videoAt();
    show(report(), { video, active: false });
    seek(video, 0.5);
    expect(screen.queryByTestId("caption")).toBeNull();
  });

  // A fixed card's original ends and stays ended through the stamp and fix clip (US19). The
  // transcript's last segment can run past the clip's real length, so currentTime alone would keep it up.
  test("none once the clip has ended", () => {
    const video = videoAt();
    show(report(), { video });
    seek(video, 3.9);
    expect(screen.getByTestId("caption").textContent).toBe("Third tire this month.");
    act(() => {
      Object.defineProperty(video, "ended", { configurable: true, value: true });
      video.dispatchEvent(new Event("ended"));
    });
    expect(screen.queryByTestId("caption")).toBeNull();
  });

  test("none while the element plays another clip", () => {
    const video = videoAt("https://files.test/fix.mp4");
    show(report(), { video });
    seek(video, 0.5);
    expect(screen.queryByTestId("caption")).toBeNull();
  });
});

describe("muted report", () => {
  test("shows neither captions nor a description, even if they leak through", () => {
    const video = videoAt();
    show(report({ audioMuted: true }), { video });
    seek(video, 0.5);
    expect(screen.queryByTestId("caption")).toBeNull();
    expect(screen.queryByTestId("description")).toBeNull();
    expect(screen.queryByText("Been here since September.")).toBeNull();
    expect(screen.getByText("Audio muted by screening · no captions")).toBeTruthy();
  });

  test("as the public projection returns it (no description or segments)", () => {
    const video = videoAt();
    show(report({ audioMuted: true, description: undefined, transcript: undefined, segments: undefined }), { video });
    seek(video, 0.5);
    expect(screen.queryByTestId("caption")).toBeNull();
    expect(screen.queryByTestId("description")).toBeNull();
  });

  test("an unmuted report shows its description", () => {
    show(report());
    expect(screen.getByTestId("description").textContent).toBe("Been here since September.");
  });
});

describe("Sample badge", () => {
  test("shows when isSample", () => {
    show(report({ isSample: true }));
    expect(screen.getByText("Sample · filmed in California")).toBeTruthy();
  });

  test("hidden otherwise", () => {
    show(report({ isSample: false }));
    expect(screen.queryByText("Sample · filmed in California")).toBeNull();
  });
});

test("the map pin links to /map?report=<id>", () => {
  show(report({ _id: "k57abc" as string }));
  expect(screen.getByRole("link", { name: "Show on map" }).getAttribute("href")).toBe("/map?report=k57abc");
});

test("title and street", () => {
  show(report());
  expect(screen.getByRole("heading").textContent).toBe("Deep pothole in the right lane");
  expect(screen.getByText("Floyd Rd SW at Church St")).toBeTruthy();
});

describe("slideshow", () => {
  const photos = ["https://files.test/p1.jpg", "https://files.test/p2.jpg", "https://files.test/p3.jpg"];
  const photoReport = () => report({ mediaType: "photos", clipUrl: null, segments: undefined, frameUrls: photos });

  test("shows every photo, with a dot each, and follows a sideways swipe", () => {
    show(photoReport());
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual(photos);
    const strip = screen.getByTestId("slideshow");
    // The highlighted dot is the wide one; check what's drawn, not just the data attribute.
    const current = () =>
      screen.getAllByTestId("slide-dot").map((d) => {
        expect(d.classList.contains("w-[18px]")).toBe(d.dataset.current === "true");
        return d.dataset.current;
      });
    expect(current()).toEqual(["true", "false", "false"]);
    expect(screen.getByText("1 / 3")).toBeTruthy();

    Object.defineProperty(strip, "clientWidth", { value: 400, configurable: true });
    for (const [left, expected] of [
      [400, ["false", "true", "false"]],
      [800, ["false", "false", "true"]],
    ] as const) {
      strip.scrollLeft = left;
      fireEvent.scroll(strip);
      expect(current()).toEqual(expected);
    }
    expect(screen.getByText("3 / 3")).toBeTruthy();
  });

  test("loads no photos until the card is near", () => {
    show(photoReport(), { near: false, active: false });
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  test("video posts have no slideshow", () => {
    show(report());
    expect(screen.queryByTestId("slideshow")).toBeNull();
  });
});

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe("fixed by", () => {
  const fixedReport = (overrides: Partial<PublicReport>) =>
    report({ status: "fixed", fixedAt: Date.now() - DAY_MS, ...overrides });

  test("a fixer's fix names their org (§3.1.2)", () => {
    show(fixedReport({ owner: "city", agency: "Mableton Sanitation", fixedByKind: "fixer", fixedByLabel: "Mableton Sanitation" }));
    expect(screen.getByTestId("fixed-by").textContent).toBe("Fixed by Mableton Sanitation");
  });

  test("a neighbor's fix names the owning agency (§4.3.2)", () => {
    show(fixedReport({ fixedByKind: "resident", fixedByLabel: "neighbor" }));
    expect(screen.getByTestId("fixed-by").textContent).toBe("Fix confirmed by a neighbor · Cobb DOT");
  });

  test("not on open cards, or when no fixer is recorded", () => {
    show(report({ fixedByKind: "fixer", fixedByLabel: "Cobb DOT" }));
    expect(screen.queryByTestId("fixed-by")).toBeNull();
    cleanup();
    show(fixedReport({ fixedByKind: undefined, fixedByLabel: undefined }));
    expect(screen.queryByTestId("fixed-by")).toBeNull();
  });
});
