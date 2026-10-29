// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MapReport } from "../../../server/map";

// Google Maps can't load in jsdom, so markers render as buttons named by their title.
vi.mock("@vis.gl/react-google-maps", () => ({
  APIProvider: ({ children }: { children: ReactNode }) => children,
  Map: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  AdvancedMarker: ({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) => (
    <button type="button" data-marker title={title} onClick={onClick}>
      {children}
    </button>
  ),
  useMap: () => null,
}));
vi.mock("@googlemaps/markerclusterer", () => ({ MarkerClusterer: vi.fn() }));

const push = vi.fn();
let search = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}));

let reports: MapReport[] | undefined;
vi.mock("../../../lib/data/useLive", () => ({ useLive: () => reports }));

const { default: MapScreen } = await import("../../../components/map/MapScreen");

const report = (id: string, title: string, status: MapReport["status"], meTooCount: number) =>
  ({ _id: id, lat: 33.8, lng: -84.58, status, meTooCount, title, category: "pothole" }) as MapReport;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "test-map-id");
  search = new URLSearchParams();
  reports = [
    report("r1", "Pothole on Floyd Rd", "open", 2),
    report("r2", "Streetlight out", "open", 0),
    report("r3", "Missed pickup", "fixed", 4),
  ];
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  push.mockReset();
});

const markerTitles = () => Array.from(document.querySelectorAll("[data-marker]")).map((m) => m.getAttribute("title"));
const filter = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

test("shows every public report, labelled 1 + me-toos, with a summary", () => {
  render(<MapScreen />);

  expect(markerTitles()).toEqual([
    "Pothole on Floyd Rd. 3 people reported this.",
    "Streetlight out. 1 person reported this.",
    "Missed pickup. Fixed. 5 people reported this.",
  ]);
  expect(screen.getByTitle("Pothole on Floyd Rd. 3 people reported this.").textContent).toBe("3");
  expect(screen.getByText("2 open · 1 fixed · 9 people reporting")).toBeTruthy();
});

test("shows a legend for the marker colors and numbers", () => {
  render(<MapScreen />);

  const legend = screen.getByRole("group", { name: "Legend" }).textContent;
  expect(legend).toContain("OpenFixedMixed");
  expect(legend).toContain("Number = original post + me-toos");
});

test("the Open / Fixed toggle filters markers by status", () => {
  render(<MapScreen />);

  filter(/^Fixed · 1$/);
  expect(markerTitles()).toEqual(["Missed pickup. Fixed. 5 people reported this."]);
  expect(screen.getByRole("button", { name: /^Fixed · 1$/ }).getAttribute("aria-pressed")).toBe("true");

  filter(/^Open · 2$/);
  expect(markerTitles()).toEqual([
    "Pothole on Floyd Rd. 3 people reported this.",
    "Streetlight out. 1 person reported this.",
  ]);

  filter(/^All$/);
  expect(markerTitles()).toHaveLength(3);
});

test("tapping a marker opens the feed at that report", () => {
  render(<MapScreen />);

  fireEvent.click(screen.getByTitle("Missed pickup. Fixed. 5 people reported this."));

  expect(push).toHaveBeenCalledWith("/?report=r3");
});

test("/map?report=<id> highlights that report", () => {
  search = new URLSearchParams("report=r2");
  render(<MapScreen />);

  const ring = (title: string) => (screen.getByTitle(title).firstElementChild as HTMLElement).style.boxShadow;
  expect(ring("Streetlight out. 1 person reported this.")).toContain("6px");
  expect(ring("Pothole on Floyd Rd. 3 people reported this.")).not.toContain("6px");
});

test("says it's loading until the query returns", () => {
  reports = undefined;
  render(<MapScreen />);

  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(markerTitles()).toEqual([]);
});

test("explains a missing Maps key instead of rendering a broken map", () => {
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAP_ID", "");
  render(<MapScreen />);

  expect(screen.queryByTestId("map")).toBeNull();
  expect(screen.getByText(/NEXT_PUBLIC_GOOGLE_MAP_ID must be set/)).toBeTruthy();
});
