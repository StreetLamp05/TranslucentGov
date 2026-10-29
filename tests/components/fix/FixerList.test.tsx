// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PublicReport } from "../../../server/lib/publicReport";
import { DEMO_POINT, DEMO_VALUE } from "../../../lib/demo";

const DAY_MS = 86_400_000;
// ~111 m per 0.001° of latitude.
const LAT_PER_100M = 0.0009;

function report(title: string, metersNorth: number, overrides: Partial<PublicReport> = {}): PublicReport {
  return {
    _id: title,
    _creationTime: 0,
    mediaType: "video",
    lat: DEMO_POINT.lat + (metersNorth / 100) * LAT_PER_100M,
    lng: DEMO_POINT.lng,
    owner: "cobb",
    agency: "Cobb DOT",
    title,
    status: "open",
    audioMuted: false,
    isSample: true,
    meTooCount: 3,
    lastActivityAt: 0,
    revealViews: 0,
    createdAt: Date.now() - 23 * DAY_MS,
    clipUrl: null,
    frameUrls: [`https://example.test/${title}.jpg`],
    fixUrl: null,
    ...overrides,
  };
}

// Server order (by_status_lat) is not distance order.
const REPORTS = [report("far", 2_500), report("near", 40), report("middle", -600)];

// Fresh modules per test, like a fresh page load (demo mode caches its flag in memory).
async function load() {
  vi.resetModules();
  return await import("../../../components/fix/FixerList");
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/fix");
});
afterEach(() => {
  cleanup();
  // @ts-expect-error removing a browser API for the test
  delete navigator.geolocation;
});

describe("sortNearestFirst", () => {
  test("orders reports by distance from DEMO_POINT", async () => {
    const { sortNearestFirst } = await load();
    const ranked = sortNearestFirst(REPORTS, DEMO_POINT);
    expect(ranked.map((r) => r.report.title)).toEqual(["near", "middle", "far"]);
    expect(ranked[0].meters).toBeCloseTo(40, -1);
    expect(ranked[1].meters).toBeCloseTo(600, -1);
    expect(ranked[2].meters).toBeCloseTo(2_500, -2);
  });

  test("keeps the incoming order for ties", async () => {
    const { sortNearestFirst } = await load();
    const ranked = sortNearestFirst([report("b", 100), report("a", -100)], DEMO_POINT);
    expect(ranked.map((r) => r.report.title)).toEqual(["b", "a"]);
  });
});

test("formatDistance", async () => {
  const { formatDistance } = await load();
  expect(formatDistance(42.4)).toBe("42 m");
  expect(formatDistance(2_480)).toBe("2.5 km");
});

describe("FixerList", () => {
  test("in demo mode, lists reports nearest to DEMO_POINT first, with distance and details", async () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    window.history.replaceState(null, "", `/fix?demo=${DEMO_VALUE}`);
    const { default: FixerList } = await load();

    render(<FixerList reports={REPORTS} />);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/^(near|middle|far)$/).textContent)).toEqual([
      "near",
      "middle",
      "far",
    ]);
    expect(screen.getAllByTestId("distance").map((d) => d.textContent)).toEqual(["40 m", "600 m", "2.5 km"]);
    const first = within(rows[0]);
    expect(first.getByText("Cobb DOT")).toBeTruthy();
    expect(first.getByText("Open · 23 days · 3 me too")).toBeTruthy();
    expect(first.getByRole("link").getAttribute("href")).toBe("/fix/near");
    expect(rows[0].querySelector("img")?.getAttribute("src")).toBe("https://example.test/near.jpg");
    // The phone's GPS is never asked for in demo mode.
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  test("without a location, lists the longest-open first and hides distance", async () => {
    const { default: FixerList } = await load();
    const now = Date.now();
    render(
      <FixerList
        reports={[report("newer", 10, { createdAt: now - DAY_MS }), report("older", 5_000, { createdAt: now - 9 * DAY_MS })]}
      />,
    );

    expect(screen.getAllByRole("listitem").map((row) => within(row).getByText(/^(newer|older)$/).textContent)).toEqual([
      "older",
      "newer",
    ]);
    expect(screen.queryAllByTestId("distance")).toHaveLength(0);
    expect(screen.getByText(/isn't sorted by distance/)).toBeTruthy();
  });

  test("shows an empty state when nothing is open", async () => {
    const { default: FixerList } = await load();
    render(<FixerList reports={[]} />);
    expect(screen.getByText("No open reports right now.")).toBeTruthy();
  });
});
