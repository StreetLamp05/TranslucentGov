// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MapReport } from "../../../server/map";

// The map against the real useLive (US37): it reads /api/map, and a report approved after the
// map opened shows up on the next poll without a refresh.

vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  AdvancedMarker: ({ title, children }: { title: string; children: ReactNode }) => (
    <button type="button" data-marker title={title}>
      {children}
    </button>
  ),
  useMap: () => null,
}));
vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const query = vi.fn();
vi.mock("../../../lib/data/api", () => ({ query: (...args: unknown[]) => query(...args), subscribeToMutations: () => () => {} }));

const { default: MapScreen } = await import("../../../components/map/MapScreen");

const markerTitles = () => Array.from(document.querySelectorAll("[data-marker]")).map((m) => m.getAttribute("title"));
const marker = (id: string, title: string) =>
  ({ _id: id, lat: 33.8, lng: -84.58, status: "open", meTooCount: 0, title, category: "pothole" }) as MapReport;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "test-map-id");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  query.mockReset();
});

test("reads /api/map and picks up a newly approved report on the next poll", async () => {
  query.mockResolvedValueOnce([marker("r1", "First")]).mockResolvedValue([marker("r1", "First"), marker("r2", "Just approved")]);
  render(<MapScreen />);
  await act(async () => {});
  expect(query).toHaveBeenCalledWith("/api/map", {}, expect.anything());
  expect(markerTitles()).toEqual(["First. 1 person reported this."]);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(markerTitles()).toEqual(["First. 1 person reported this.", "Just approved. 1 person reported this."]);
  expect(screen.getByText("2 open · 0 fixed · 2 people reporting")).toBeTruthy();
});
